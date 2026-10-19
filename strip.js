// Booth 677 — the darkroom. Everything that draws a strip lives here: the six frames, the six film looks,
// grain / light leak overlays, the orange 7-segment date stamp and the doodle sample photos.
// Pure canvas, no network: Take Photo → Develop → Download works offline once the page has loaded.
(() => {
  'use strict';

  const INK = '#1E1E1E';
  const CREAM = '#FFF9F0';
  const PINK = '#E8C9C6';
  const DENIM = '#7F96B8';
  const RED = '#D9473A';
  const GREEN = '#4F8A63';
  const MUSTARD = '#C9A24A';
  const SKY = '#DCEBF3';
  const STAMP = '#FF8A2A';
  const TYPE = '"Courier Prime", "DM Mono", ui-monospace, monospace';
  const HAND = '"Gaegu", "Patrick Hand", "Comic Sans MS", cursive';
  const SCRIPT = '"Patrick Hand", "Gaegu", cursive';

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }
  // A hand-drawn outline: each edge is split into short segments nudged by a seeded wobble.
  function sketchRect(ctx, x, y, w, h, rand, { wob = 3, r = 0 } = {}) {
    const pts = [];
    const edge = (x1, y1, x2, y2) => {
      const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 60));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        pts.push([x1 + (x2 - x1) * t + (rand() - 0.5) * wob, y1 + (y2 - y1) * t + (rand() - 0.5) * wob]);
      }
    };
    edge(x + r, y, x + w - r, y);
    edge(x + w, y + r, x + w, y + h - r);
    edge(x + w - r, y + h, x + r, y + h);
    edge(x, y + h - r, x, y + r);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i <= pts.length; i++) {
      const [px, py] = pts[i % pts.length];
      const [qx, qy] = pts[(i + 1) % pts.length];
      ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
    }
    ctx.closePath();
  }
  function text(ctx, str, x, y, { font, color = INK, align = 'center', baseline = 'middle', maxW } = {}) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(str, x, y, maxW);
    ctx.restore();
  }
  function star(ctx, x, y, r, color) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }
  function heart(ctx, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 20, s / 20);
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-14, -4, -8, -16, 0, -8);
    ctx.bezierCurveTo(8, -16, 14, -4, 0, 6);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  }
  function tape(ctx, x, y, w, h, rot, color = 'rgba(244, 226, 170, 0.85)') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-w / 2 + (w / 6) * i, -h / 2 + (i % 2 ? 4 : 0));
    ctx.lineTo(w / 2, h / 2);
    for (let i = 6; i >= 0; i--) ctx.lineTo(-w / 2 + (w / 6) * i, h / 2 - (i % 2 ? 4 : 0));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // 7-segment date stamp — one geometry for canvas and SVG
  // ------------------------------------------------------------------
  // Cell 12 × 20, segment thickness 2.4. Digits advance 16, apostrophe 7, space 9.
  const SEGS = {
    a: [2, 0, 8, 2.4], b: [9.6, 1.6, 2.4, 7.6], c: [9.6, 10.8, 2.4, 7.6], d: [2, 17.6, 8, 2.4],
    e: [0, 10.8, 2.4, 7.6], f: [0, 1.6, 2.4, 7.6], g: [2, 8.8, 8, 2.4],
  };
  const DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
  function segRects(str) {
    const rects = [];
    let x = 0;
    for (const ch of str) {
      if (ch === "'") { rects.push([x + 1, 0, 2.4, 5.5]); x += 7; continue; }
      if (ch === ' ') { x += 9; continue; }
      const d = DIGITS[Number(ch)];
      if (d) for (const s of d) { const [sx, sy, sw, sh] = SEGS[s]; rects.push([x + sx, sy, sw, sh]); }
      x += 16;
    }
    return { rects, width: x - 4, height: 20 };
  }
  function dateText(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `'${p(d.getFullYear() % 100)} ${p(d.getMonth() + 1)} ${p(d.getDate())}`;
  }
  function drawSeg(ctx, str, x, y, height, { color = STAMP, align = 'right' } = {}) {
    const { rects, width } = segRects(str);
    const s = height / 20;
    ctx.save();
    ctx.translate(align === 'right' ? x - width * s : x, y);
    ctx.scale(s, s);
    ctx.transform(1, 0, -0.08, 1, 0, 0); // a slight italic lean like real film cameras
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(255, 110, 20, 0.85)';
    ctx.shadowBlur = 6;
    for (const [rx, ry, rw, rh] of rects) ctx.fillRect(rx, ry, rw, rh);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#FFD9A0';
    for (const [rx, ry, rw, rh] of rects) ctx.fillRect(rx + rw * 0.3, ry + rh * 0.3, rw * 0.4, rh * 0.4);
    ctx.restore();
  }
  function segSVG(str, { color = STAMP, height = 20 } = {}) {
    const { rects, width } = segRects(str);
    const body = rects.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.6"/>`).join('');
    return `<svg class="seg" viewBox="-2 -2 ${width + 6} 24" height="${height}" aria-label="${str}" role="img"><g fill="${color}" transform="skewX(-5)" style="filter:drop-shadow(0 0 2px rgba(255,110,20,.8))">${body}</g></svg>`;
  }

  // ------------------------------------------------------------------
  // Film looks (pixel ops — canvas `filter` is not supported in Safari)
  // ------------------------------------------------------------------
  const LOOKS = [
    { id: 0, name: 'Original', swatch: '#F3D9C9' },
    { id: 1, name: 'B&W', swatch: '#9A9A9A' },
    { id: 2, name: 'Sepia', swatch: '#B98B5E' },
    { id: 3, name: 'Faded 90s', swatch: '#D9B8C4' },
    { id: 4, name: 'Cool Film', swatch: '#8FB3C9' },
    { id: 5, name: 'Warm Film', swatch: '#E7A65F' },
  ];
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const curve = (fn) => { const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = clamp(fn(i)); return t; };
  const contrast = (k, lift = 0) => (v) => (v - 128) * k + 128 + lift;
  const LOOK_OPS = [
    null,
    { m: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114], lut: [curve(contrast(1.15, -4)), curve(contrast(1.15, -4)), curve(contrast(1.15, -4))] },
    { m: [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131], lut: [curve((v) => v * 0.92 + 14), curve((v) => v * 0.9 + 10), curve((v) => v * 0.86 + 8)] },
    { m: desat(0.72), lut: [curve((v) => contrast(0.8)(v) * 0.86 + 40), curve((v) => contrast(0.8)(v) * 0.84 + 30), curve((v) => contrast(0.8)(v) * 0.84 + 38)] },
    { m: desat(0.9), lut: [curve((v) => contrast(1.06)(v) * 0.9 - 2), curve((v) => contrast(1.06)(v) * 0.98 + 6), curve((v) => contrast(1.04)(v) * 1.02 + 22)] },
    { m: desat(1.12), lut: [curve((v) => contrast(1.05)(v) * 1.04 + 16), curve((v) => contrast(1.04)(v) * 1.0 + 4), curve((v) => contrast(1.02)(v) * 0.84 - 2)] },
  ];
  function desat(s) {
    const r = 0.299 * (1 - s), g = 0.587 * (1 - s), b = 0.114 * (1 - s);
    return [r + s, g, b, r, g + s, b, r, g, b + s];
  }
  function applyLook(ctx, w, h, look) {
    const op = LOOK_OPS[look];
    if (!op) return;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = op.m;
    const [lr, lg, lb] = op.lut;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = lr[clamp(r * m0 + g * m1 + b * m2) | 0];
      d[i + 1] = lg[clamp(r * m3 + g * m4 + b * m5) | 0];
      d[i + 2] = lb[clamp(r * m6 + g * m7 + b * m8) | 0];
    }
    ctx.putImageData(img, 0, 0);
  }

  let grainTile = null;
  function grain(ctx, w, h, scale) {
    if (!grainTile) {
      grainTile = canvas(160, 160);
      const g = grainTile.getContext('2d');
      const img = g.createImageData(160, 160);
      const rand = rng(677);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 128 + (rand() + rand() + rand() - 1.5) * 150;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v);
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    ctx.save();
    const pattern = ctx.createPattern(grainTile, 'repeat');
    pattern.setTransform?.(new DOMMatrix().scale(Math.max(1, 1.6 * scale)));
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  function lightLeak(ctx, w, h, rand) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const corner = Math.floor(rand() * 4);
    const cx = corner % 2 ? w * (0.9 + rand() * 0.15) : -w * (0.05 + rand() * 0.1);
    const cy = corner < 2 ? h * (rand() * 0.4) : h * (0.6 + rand() * 0.4);
    const r = Math.max(w, h) * (0.55 + rand() * 0.3);
    let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255, 170, 70, 0.85)');
    g.addColorStop(0.35, 'rgba(255, 90, 50, 0.45)');
    g.addColorStop(1, 'rgba(255, 60, 60, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const sx = w * (0.2 + rand() * 0.6);
    g = ctx.createLinearGradient(sx - w * 0.15, 0, sx + w * 0.15, 0);
    g.addColorStop(0, 'rgba(255, 120, 160, 0)');
    g.addColorStop(0.5, `rgba(255, 140, 120, ${0.18 + rand() * 0.15})`);
    g.addColorStop(1, 'rgba(255, 120, 160, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Photos: cover-fit with an optional crop { cx, cy, zoom } (cx/cy = 0..1 centre of the source)
  // ------------------------------------------------------------------
  function sourceSize(src) {
    return [src.naturalWidth || src.videoWidth || src.width, src.naturalHeight || src.videoHeight || src.height];
  }
  function coverRect(src, dw, dh, crop = {}) {
    const [sw, sh] = sourceSize(src);
    const zoom = Math.max(1, crop.zoom || 1);
    const scale = Math.max(dw / sw, dh / sh) * zoom;
    const cw = dw / scale, ch = dh / scale;
    const cx = (crop.cx ?? 0.5) * sw, cy = (crop.cy ?? 0.5) * sh;
    const x = Math.min(Math.max(cx - cw / 2, 0), sw - cw);
    const y = Math.min(Math.max(cy - ch / 2, 0), sh - ch);
    return [x, y, cw, ch];
  }
  function blankSlot(ctx, w, h, i) {
    ctx.fillStyle = [CREAM, '#F7E6E3', '#E6EFF5', '#F4EBD3'][i % 4];
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2 - s * 0.08);
    ctx.lineWidth = Math.max(2, s * 0.018);
    ctx.strokeStyle = INK;
    ctx.fillStyle = '#FFE58A';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(-s * 0.07, -s * 0.04, s * 0.022, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.07, -s * 0.04, s * 0.022, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, s * 0.03, s * 0.09, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.restore();
    text(ctx, 'say cheese!', w / 2, h / 2 + s * 0.27, { font: `700 ${Math.round(s * 0.11)}px ${HAND}`, color: INK });
    star(ctx, w * 0.18, h * 0.2, s * 0.05, MUSTARD);
    star(ctx, w * 0.84, h * 0.76, s * 0.04, PINK);
  }
  // Draws photo `i` into a slot-sized canvas with the look, leak and grain applied.
  function developSlot(photo, w, h, i, opts, rand, scale) {
    const c = canvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!photo) { blankSlot(ctx, c.width, c.height, i); return c; }
    const [sx, sy, sw, sh] = coverRect(photo.src, c.width, c.height, photo.crop);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo.src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    applyLook(ctx, c.width, c.height, opts.look);
    if (opts.leak) lightLeak(ctx, c.width, c.height, rand);
    if (opts.grain) grain(ctx, c.width, c.height, scale);
    return c;
  }

  // ------------------------------------------------------------------
  // Frames — coordinates are final (2×) pixels; the long side never exceeds 2400.
  // ------------------------------------------------------------------
  const FRAMES = [
    {
      id: 0, name: 'Classic strip', blurb: 'The 4-cut photo booth strip.', W: 800, H: 2400,
      slots: [50, 551, 1052, 1553].map((y) => ({ x: 50, y, w: 700, h: 467 })),
      base(ctx) {
        ctx.fillStyle = '#FFFDF8';
        ctx.fillRect(0, 0, this.W, this.H);
      },
      top(ctx, o) {
        if (o.caption) text(ctx, o.caption, 400, 2130, { font: `700 60px ${TYPE}`, maxW: 700 });
        text(ctx, 'BOOTH · 677', 400, o.caption ? 2250 : 2170, { font: `700 40px ${TYPE}`, color: RED });
        star(ctx, 120, o.caption ? 2250 : 2170, 18, MUSTARD);
        star(ctx, 680, o.caption ? 2250 : 2170, 18, MUSTARD);
      },
    },
    {
      id: 1, name: '2×2 grid', blurb: 'Four squares, one cute card.', W: 1600, H: 1900,
      slots: [[70, 70], [820, 70], [70, 820], [820, 820]].map(([x, y]) => ({ x, y, w: 710, h: 710, r: 22 })),
      base(ctx, rand) {
        ctx.fillStyle = PINK;
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let i = 0; i < 70; i++) { ctx.beginPath(); ctx.arc(rand() * this.W, rand() * this.H, 6 + rand() * 8, 0, 7); ctx.fill(); }
      },
      outline(ctx, rand) {
        ctx.lineWidth = 7;
        ctx.strokeStyle = INK;
        for (const s of this.slots) { sketchRect(ctx, s.x, s.y, s.w, s.h, rand, { r: 10 }); ctx.stroke(); }
      },
      top(ctx, o) {
        if (o.caption) text(ctx, o.caption, 800, 1660, { font: `700 76px ${TYPE}`, maxW: 1400 });
        text(ctx, 'BOOTH · 677', 800, o.caption ? 1790 : 1700, { font: `700 48px ${TYPE}`, color: RED });
        heart(ctx, 120, 1720, 70, RED);
        heart(ctx, 1480, 1720, 70, RED);
      },
    },
    {
      id: 2, name: 'Polaroid', blurb: 'Four instant prints, taped down.', W: 1800, H: 2100,
      slots: [[470, 510, -0.035], [1330, 530, 0.03], [470, 1450, 0.025], [1330, 1440, -0.03]]
        .map(([cx, cy, rot]) => ({ x: cx - 330, y: cy - 375, w: 660, h: 660, rot, card: { cx, cy } })),
      base(ctx, rand) {
        ctx.fillStyle = '#EFE3CF';
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.fillStyle = 'rgba(160, 120, 70, 0.08)';
        for (let i = 0; i < 400; i++) ctx.fillRect(rand() * this.W, rand() * this.H, 3, 3);
        for (const s of this.slots) {
          ctx.save();
          ctx.translate(s.card.cx, s.card.cy);
          ctx.rotate(s.rot);
          ctx.shadowColor = 'rgba(0,0,0,0.18)';
          ctx.shadowBlur = 24;
          ctx.shadowOffsetY = 10;
          ctx.fillStyle = '#FFFEFA';
          ctx.fillRect(-380, -425, 760, 880);
          ctx.shadowColor = 'transparent';
          ctx.lineWidth = 5;
          ctx.strokeStyle = INK;
          sketchRect(ctx, -380, -425, 760, 880, rand);
          ctx.stroke();
          ctx.restore();
        }
      },
      top(ctx, o, rand) {
        this.slots.forEach((s, i) => {
          ctx.save();
          ctx.translate(s.card.cx, s.card.cy);
          ctx.rotate(s.rot);
          if (i === 0 && o.caption) text(ctx, o.caption, 0, 375, { font: `64px ${SCRIPT}`, maxW: 680 });
          if (i === 3) text(ctx, 'booth 677 ♡', 0, 375, { font: `56px ${SCRIPT}`, color: RED });
          tape(ctx, 0, -425, 220, 64, (rand() - 0.5) * 0.3);
          ctx.restore();
        });
      },
    },
    {
      id: 3, name: 'Handheld', blurb: 'A pocket game console, but it’s you.', W: 1400, H: 2300,
      slots: [[230, 230], [715, 230], [230, 715], [715, 715]].map(([x, y]) => ({ x, y, w: 455, h: 455, r: 8 })),
      base(ctx, rand) {
        const W = this.W, H = this.H;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#DDD8CC';
        ctx.beginPath();
        ctx.moveTo(60, 110);
        ctx.quadraticCurveTo(60, 40, 130, 40);
        ctx.lineTo(W - 130, 40);
        ctx.quadraticCurveTo(W - 60, 40, W - 60, 110);
        ctx.lineTo(W - 60, H - 300);
        ctx.quadraticCurveTo(W - 60, H - 40, W - 320, H - 40);
        ctx.lineTo(130, H - 40);
        ctx.quadraticCurveTo(60, H - 40, 60, H - 110);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 9;
        ctx.strokeStyle = INK;
        ctx.stroke();
        // screen bezel
        ctx.fillStyle = '#5B5F73';
        roundRect(ctx, 140, 140, W - 280, 1150, [30, 30, 110, 30]);
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.fillStyle = '#20232E';
        ctx.fillRect(215, 215, 970, 970);
        ctx.fillStyle = RED;
        ctx.beginPath(); ctx.arc(180, 560, 12, 0, 7); ctx.fill();
        text(ctx, 'BATTERY', 180, 600, { font: `700 18px ${TYPE}`, color: '#C9CCD8' });
        text(ctx, 'BOOTH·677 ', 640, 1240, { font: `italic 700 40px ${TYPE}`, color: '#E7E3F2', align: 'right' });
        text(ctx, 'POCKET COLOR', 650, 1240, { font: `italic 700 40px ${TYPE}`, color: '#F2B5C4', align: 'left' });
        // d-pad
        ctx.fillStyle = '#2C2C34';
        ctx.lineWidth = 6;
        roundRect(ctx, 210, 1560, 270, 90, 14); ctx.fill(); ctx.stroke();
        roundRect(ctx, 300, 1470, 90, 270, 14); ctx.fill(); ctx.stroke();
        ctx.fillRect(213, 1563, 264, 84);
        // A / B
        for (const [x, y, l] of [[1000, 1640, 'B'], [1170, 1540, 'A']]) {
          ctx.fillStyle = '#B83A6B';
          ctx.beginPath(); ctx.arc(x, y, 72, 0, 7); ctx.fill(); ctx.stroke();
          text(ctx, l, x, y + 120, { font: `700 40px ${TYPE}`, color: '#3A3A66' });
        }
        // start / select
        for (const [x, l] of [[560, 'SELECT'], [800, 'START']]) {
          ctx.save();
          ctx.translate(x, 1900);
          ctx.rotate(-0.45);
          ctx.fillStyle = '#8B8798';
          roundRect(ctx, -60, -18, 120, 36, 18); ctx.fill(); ctx.stroke();
          ctx.restore();
          text(ctx, l, x, 1970, { font: `700 28px ${TYPE}`, color: '#3A3A66' });
        }
        // speaker
        ctx.save();
        ctx.translate(1110, 2020);
        ctx.rotate(-0.45);
        ctx.fillStyle = '#9B968A';
        for (let i = 0; i < 6; i++) { roundRect(ctx, -110, -60 + i * 26, 220, 12, 6); ctx.fill(); }
        ctx.restore();
        void rand;
      },
      top(ctx, o) {
        if (o.caption) text(ctx, o.caption, 640, 2150, { font: `700 48px ${TYPE}`, color: '#3A3A66', maxW: 800 });
      },
    },
    {
      id: 4, name: 'Film negative', blurb: 'Contact-sheet film with sprocket holes.', W: 900, H: 2400,
      slots: [110, 618, 1126, 1634].map((y) => ({ x: 110, y, w: 680, h: 453, r: 6 })),
      base(ctx) {
        ctx.fillStyle = '#1D1A17';
        ctx.fillRect(0, 0, this.W, this.H);
        for (let y = 30; y < this.H - 40; y += 96) {
          for (const x of [24, 838]) { roundRect(ctx, x, y, 38, 56, 8); ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(); ctx.restore(); }
        }
        const label = { font: `700 26px ${TYPE}`, color: '#F0A040' };
        ['1', '1A', '2', '2A', '3', '3A', '4', '4A'].forEach((l, i) => {
          const y = this.slots[Math.floor(i / 2)].y + (i % 2 ? 453 + 28 : -24);
          if (y > 0) text(ctx, `${i % 2 ? '▸ ' : ''}${l}`, i % 2 ? 760 : 140, y, { ...label, align: i % 2 ? 'right' : 'left' });
        });
        ctx.save();
        ctx.translate(86, 1200);
        ctx.rotate(-Math.PI / 2);
        text(ctx, 'BOOTH 677 · 400 · SAFETY FILM · BOOTH 677 · 400', 0, 0, { font: `700 22px ${TYPE}`, color: '#F0A040' });
        ctx.restore();
      },
      top(ctx, o) {
        if (o.caption) text(ctx, o.caption, 450, 2200, { font: `700 50px ${TYPE}`, color: CREAM, maxW: 680 });
        text(ctx, '677 FILM ◂ 400 ▸', 450, o.caption ? 2300 : 2230, { font: `700 30px ${TYPE}`, color: '#F0A040' });
      },
    },
    {
      id: 5, name: 'Postcard', blurb: 'Greetings from Booth 677!', W: 2200, H: 1460,
      slots: [[80, 90], [620, 90], [80, 700], [620, 700]].map(([x, y]) => ({ x, y, w: 500, h: 560, r: 12 })),
      base(ctx, rand) {
        ctx.fillStyle = '#FBF4E6';
        ctx.fillRect(0, 0, this.W, this.H);
        // airmail border: diagonal stripes in a band around the edge
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, this.W, this.H);
        ctx.rect(24, 24, this.W - 48, this.H - 48);
        ctx.clip('evenodd');
        ctx.lineWidth = 26;
        for (let x = -this.H, i = 0; x < this.W + this.H; x += 60, i++) {
          ctx.strokeStyle = i % 2 ? RED : DENIM;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + this.H, this.H); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 8;
        sketchRect(ctx, 24, 24, this.W - 48, this.H - 48, rand, { wob: 4 });
        ctx.stroke();
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(1190, 120); ctx.lineTo(1186, 1340); ctx.stroke();
        // stamp
        ctx.save();
        ctx.translate(1820, 90);
        ctx.fillStyle = CREAM;
        ctx.fillRect(0, 0, 290, 340);
        ctx.fillStyle = '#FBF4E6';
        for (let i = 0; i <= 10; i++) for (const [x, y] of [[i * 29, 0], [i * 29, 340], [0, i * 34], [290, i * 34]]) { ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill(); }
        ctx.fillStyle = PINK;
        ctx.fillRect(28, 28, 234, 284);
        ctx.fillStyle = DENIM;
        ctx.fillRect(98, 120, 94, 150);
        ctx.fillStyle = RED;
        ctx.fillRect(78, 70, 134, 40);
        text(ctx, '677', 145, 92, { font: `700 30px ${TYPE}`, color: CREAM });
        text(ctx, 'BOT', 145, 292, { font: `700 22px ${TYPE}` });
        ctx.restore();
        // postmark
        ctx.save();
        ctx.strokeStyle = 'rgba(30,30,30,0.55)';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(1730, 330, 120, 0, 7); ctx.stroke();
        text(ctx, 'BOT CHAIN', 1730, 300, { font: `700 30px ${TYPE}`, color: 'rgba(30,30,30,0.6)' });
        text(ctx, 'ID 677', 1730, 352, { font: `700 30px ${TYPE}`, color: 'rgba(30,30,30,0.6)' });
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          for (let x = 1860; x < 2140; x += 10) ctx.lineTo(x, 470 + i * 26 + Math.sin(x / 22) * 8);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(30,30,30,0.35)';
        ctx.lineWidth = 4;
        for (const y of [900, 1040, 1180]) { ctx.beginPath(); ctx.moveTo(1290, y); ctx.lineTo(2110, y); ctx.stroke(); }
      },
      outline(ctx, rand) {
        ctx.lineWidth = 6;
        ctx.strokeStyle = INK;
        for (const s of this.slots) { sketchRect(ctx, s.x, s.y, s.w, s.h, rand, { r: 8 }); ctx.stroke(); }
      },
      top(ctx, o) {
        text(ctx, 'Greetings from', 1290, 640, { font: `700 84px ${HAND}`, color: INK, align: 'left' });
        text(ctx, 'Booth 677!', 1290, 740, { font: `700 110px ${HAND}`, color: RED, align: 'left' });
        if (o.caption) text(ctx, o.caption, 1300, 870, { font: `70px ${SCRIPT}`, align: 'left', baseline: 'alphabetic', maxW: 800 });
        text(ctx, 'xoxo', 1300, 1150, { font: `64px ${SCRIPT}`, align: 'left', baseline: 'alphabetic', color: '#5A5A5A' });
      },
    },
  ];

  // ------------------------------------------------------------------
  // Render a strip
  // ------------------------------------------------------------------
  // opts: { frame, photos: [{ src, crop } | null ×4], look, grain, leak, date (string|false), caption, fill: 'repeat'|'blank', seed }
  function render(opts, scale = 1) {
    const f = FRAMES[opts.frame] || FRAMES[0];
    const c = canvas(f.W * scale, f.H * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    const rand = rng(opts.seed || 1);
    f.base(ctx, rng((opts.seed || 1) + 11));

    const given = (opts.photos || []).filter(Boolean);
    const photos = f.slots.map((_, i) => opts.photos?.[i] || (opts.fill === 'blank' || !given.length ? null : given[i % given.length]));
    let lastPhoto = -1;
    f.slots.forEach((s, i) => {
      const img = developSlot(photos[i], s.w * scale, s.h * scale, i, opts, rand, scale);
      if (photos[i]) lastPhoto = i;
      ctx.save();
      if (s.rot) {
        ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
        ctx.rotate(s.rot);
        ctx.translate(-(s.x + s.w / 2), -(s.y + s.h / 2));
      }
      roundRect(ctx, s.x, s.y, s.w, s.h, s.r || 0);
      ctx.clip();
      ctx.drawImage(img, s.x, s.y, s.w, s.h);
      // the date stamp goes on the last real photo, bottom right, like a film camera
      if (opts.date && i === f.slots.length - 1) {
        const target = lastPhoto === i ? s : null;
        if (target) drawSeg(ctx, opts.date, s.x + s.w - s.w * 0.06, s.y + s.h - s.w * 0.06 - s.w * 0.065, s.w * 0.065);
      }
      ctx.restore();
    });
    // a strip whose final slot is blank still gets its stamp on the last real photo
    if (opts.date && lastPhoto >= 0 && lastPhoto !== f.slots.length - 1) {
      const s = f.slots[lastPhoto];
      ctx.save();
      if (s.rot) { ctx.translate(s.x + s.w / 2, s.y + s.h / 2); ctx.rotate(s.rot); ctx.translate(-(s.x + s.w / 2), -(s.y + s.h / 2)); }
      drawSeg(ctx, opts.date, s.x + s.w - s.w * 0.06, s.y + s.h - s.w * 0.06 - s.w * 0.065, s.w * 0.065);
      ctx.restore();
    }
    f.outline?.call(f, ctx, rng((opts.seed || 1) + 23));
    f.top.call(f, ctx, { caption: (opts.caption || '').trim() }, rng((opts.seed || 1) + 37));
    return c;
  }

  // One developed photo on its own (the Film looks demo): look + leak + grain + optional date stamp.
  function print(src, w, h, opts = {}) {
    const c = developSlot({ src, crop: opts.crop }, w, h, 0, opts, rng(opts.seed || 3), w / 600);
    if (opts.date) drawSeg(c.getContext('2d'), opts.date, w * 0.94, h - w * 0.06 - w * 0.065, w * 0.065);
    return c;
  }

  const ready = () => {
    if (!document.fonts?.load) return Promise.resolve();
    return Promise.all([
      `700 40px "Courier Prime"`, `40px "Courier Prime"`, `700 40px "Gaegu"`, `40px "Patrick Hand"`,
    ].map((f) => document.fonts.load(f).catch(() => {}))).then(() => {});
  };

  // ------------------------------------------------------------------
  // Doodle sample photos (our own art) — used for frame samples, the wall in preview, and demos
  // ------------------------------------------------------------------
  const BGS = ['#F6C9C3', '#BFD8E8', '#F3E2A9', '#C9E2C6', '#E3D0F0', '#F8D7B5'];
  const SKIN = ['#F6D3B8', '#E9B996', '#C98E6A', '#8D5A3B'];
  const HAIR = ['#2B2120', '#5A3A28', '#1E1E1E', '#B5643C'];
  function doodle(pose = 0, w = 600, h = 600, who = 0) {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    const rand = rng(pose * 31 + who * 7 + 5);
    const s = Math.min(w, h);
    ctx.fillStyle = BGS[(pose + who * 2) % BGS.length];
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = ['rgba(255,255,255,.6)', 'rgba(217,71,58,.35)', 'rgba(127,150,184,.45)'][i % 3];
      ctx.beginPath(); ctx.arc(rand() * w, rand() * h, s * (0.008 + rand() * 0.014), 0, 7); ctx.fill();
    }
    const cx = w / 2 + (pose === 2 ? -s * 0.05 : pose === 3 ? s * 0.05 : 0);
    const cy = h * 0.5;
    const r = s * 0.24;
    const lw = Math.max(2, s * 0.012);
    ctx.lineWidth = lw;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    const skin = SKIN[who % SKIN.length], hair = HAIR[who % HAIR.length];
    // shoulders
    ctx.fillStyle = [RED, DENIM, GREEN, MUSTARD][(pose + who) % 4];
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 2.15, r * 1.55, r * 1.05, 0, Math.PI, 0);
    ctx.lineTo(cx + r * 1.55, h + lw);
    ctx.lineTo(cx - r * 1.55, h + lw);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // hair back
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.1, r * 1.18, r * 1.25, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // face
    ctx.fillStyle = skin;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(pose === 2 ? -0.12 : pose === 3 ? 0.1 : 0);
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // bangs
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(-r * 0.98, -r * 0.1);
    ctx.quadraticCurveTo(-r * 0.9, -r * 1.15, 0, -r * 1.05);
    ctx.quadraticCurveTo(r * 0.9, -r * 1.15, r * 0.98, -r * 0.1);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.55, r * 0.1, -r * 0.45);
    ctx.quadraticCurveTo(-r * 0.4, -r * 0.6, -r * 0.98, -r * 0.1);
    ctx.fill(); ctx.stroke();
    // blush
    ctx.fillStyle = 'rgba(232, 110, 110, 0.45)';
    ctx.beginPath(); ctx.ellipse(-r * 0.55, r * 0.25, r * 0.17, r * 0.1, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.55, r * 0.25, r * 0.17, r * 0.1, 0, 0, 7); ctx.fill();
    // eyes
    ctx.fillStyle = INK;
    const eye = (x, kind) => {
      ctx.beginPath();
      if (kind === 'dot') { ctx.arc(x, 0, r * 0.08, 0, 7); ctx.fill(); }
      else if (kind === 'happy') { ctx.arc(x, r * 0.05, r * 0.11, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
      else if (kind === 'wink') { ctx.moveTo(x - r * 0.11, 0); ctx.lineTo(x + r * 0.11, 0); ctx.stroke(); }
      else { ctx.arc(x, 0, r * 0.11, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + r * 0.03, -r * 0.03, r * 0.035, 0, 7); ctx.fill(); ctx.fillStyle = INK; }
    };
    const eyes = [['dot', 'dot'], ['happy', 'happy'], ['dot', 'wink'], ['big', 'big']][pose % 4];
    eye(-r * 0.35, eyes[0]);
    eye(r * 0.35, eyes[1]);
    // mouth
    ctx.beginPath();
    if (pose % 4 === 3) { ctx.fillStyle = '#7A2E2E'; ctx.ellipse(0, r * 0.45, r * 0.1, r * 0.13, 0, 0, 7); ctx.fill(); ctx.stroke(); }
    else if (pose % 4 === 1) { ctx.fillStyle = '#7A2E2E'; ctx.moveTo(-r * 0.2, r * 0.32); ctx.quadraticCurveTo(0, r * 0.68, r * 0.2, r * 0.32); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else { ctx.arc(0, r * 0.28, r * 0.18, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); }
    ctx.restore();
    // peace sign / hearts / sparkles
    if (pose % 4 === 1) {
      const hx = cx + r * 1.25, hy = cy + r * 0.55;
      ctx.fillStyle = skin;
      for (const a of [-0.35, 0.05]) {
        ctx.save(); ctx.translate(hx, hy); ctx.rotate(a);
        roundRect(ctx, -r * 0.09, -r * 0.75, r * 0.18, r * 0.75, r * 0.09); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath(); ctx.ellipse(hx, hy + r * 0.08, r * 0.24, r * 0.22, 0, 0, 7); ctx.fill(); ctx.stroke();
    } else if (pose % 4 === 2) {
      heart(ctx, cx + r * 1.35, cy - r * 0.9, s * 0.09, RED);
      heart(ctx, cx + r * 1.65, cy - r * 0.35, s * 0.06, '#F28BA8');
    } else if (pose % 4 === 3) {
      star(ctx, cx - r * 1.4, cy - r * 0.9, s * 0.05, '#FFE58A');
      star(ctx, cx + r * 1.4, cy - r * 0.6, s * 0.04, '#FFE58A');
    } else {
      ctx.fillStyle = MUSTARD;
      star(ctx, cx + r * 1.4, cy - r * 1.0, s * 0.045, '#FFE58A');
    }
    return c;
  }

  // A tonally rich sample "photo" (our own drawing) for the Film looks demo.
  function scene(w = 900, h = 640) {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    let g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    g.addColorStop(0, '#6FA8DC');
    g.addColorStop(0.6, '#F6C6A8');
    g.addColorStop(1, '#F7A97C');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#FFE7A8';
    ctx.beginPath(); ctx.arc(w * 0.72, h * 0.5, h * 0.12, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (const [x, y, s] of [[0.2, 0.18, 1], [0.55, 0.12, 0.7], [0.85, 0.25, 0.8]]) {
      ctx.beginPath();
      ctx.ellipse(w * x, h * y, h * 0.09 * s, h * 0.035 * s, 0, 0, 7);
      ctx.ellipse(w * x + h * 0.06 * s, h * y - h * 0.02 * s, h * 0.06 * s, h * 0.03 * s, 0, 0, 7);
      ctx.fill();
    }
    g = ctx.createLinearGradient(0, h * 0.58, 0, h);
    g.addColorStop(0, '#3E7FA6');
    g.addColorStop(1, '#1F4E6B');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.58, w, h * 0.42);
    ctx.fillStyle = 'rgba(255, 231, 168, .55)';
    for (let i = 0; i < 9; i++) ctx.fillRect(w * 0.64 + Math.sin(i) * 20, h * (0.6 + i * 0.03), w * 0.16 - i * 6, 4);
    ctx.fillStyle = '#E9D2A8';
    ctx.beginPath(); ctx.moveTo(0, h * 0.82); ctx.quadraticCurveTo(w * 0.35, h * 0.74, w * 0.6, h); ctx.lineTo(0, h); ctx.fill();
    // a tiny pink booth on the sand
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.fillStyle = PINK;
    ctx.fillRect(w * 0.12, h * 0.6, w * 0.14, h * 0.26); ctx.strokeRect(w * 0.12, h * 0.6, w * 0.14, h * 0.26);
    ctx.fillStyle = DENIM;
    ctx.fillRect(w * 0.14, h * 0.67, w * 0.06, h * 0.19); ctx.strokeRect(w * 0.14, h * 0.67, w * 0.06, h * 0.19);
    ctx.fillStyle = RED;
    ctx.fillRect(w * 0.115, h * 0.56, w * 0.15, h * 0.05); ctx.strokeRect(w * 0.115, h * 0.56, w * 0.15, h * 0.05);
    // palm
    ctx.strokeStyle = '#4A3424';
    ctx.lineWidth = w * 0.014;
    ctx.beginPath(); ctx.moveTo(w * 0.4, h * 0.9); ctx.quadraticCurveTo(w * 0.43, h * 0.6, w * 0.38, h * 0.36); ctx.stroke();
    ctx.fillStyle = '#2F6B45';
    for (const a of [-2.6, -2.0, -1.2, -0.5, 0.1]) {
      ctx.save(); ctx.translate(w * 0.38, h * 0.36); ctx.rotate(a);
      ctx.beginPath(); ctx.ellipse(w * 0.08, 0, w * 0.09, h * 0.025, 0, 0, 7); ctx.fill();
      ctx.restore();
    }
    return c;
  }

  window.Strip = { FRAMES, LOOKS, render, print, ready, doodle, scene, dateText, segSVG, coverRect, sourceSize, rng };
})();
