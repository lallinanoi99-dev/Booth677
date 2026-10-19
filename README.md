# Booth 677

A cute, hand-drawn analog photo booth in your browser. Scroll inside, strike four poses (or upload photos), get a retro photo strip, and keep it forever on BOT Chain.

*Private by default: only the strip's SHA-256 fingerprint goes on-chain and the photo stays on your device. Public strips go to IPFS and the Strip Wall, permanently. No tokens, no payments, no admin.*

## Status

| | |
|---|---|
| Live site | https://lallinanoi99-dev.github.io/Booth677/ |
| Upload Worker | _not deployed yet_ |
| Contract (BOT Chain testnet, chain ID 968) | _not deployed yet_ |
| Contract (BOT Chain mainnet, chain ID 677) | [`0xb64ABCa2Ca323Ef1D36c8FcA608fb0B1bF971E04`](https://scan.botchain.ai/address/0xb64ABCa2Ca323Ef1D36c8FcA608fb0B1bF971E04) |
| Source | https://github.com/lallinanoi99-dev/Booth677 |

## Project layout

- `index.html`, `styles.css`: the page (hero booth illustration, the six home sections, footer)
- `app.js`: the booth flow, wallet, Strip Wall, `?strip=` pages and the GSAP scroll-into-the-booth hero. `CONFIG` at the top is the only thing to edit after deploying.
- `strip.js`: the darkroom. Six frames, six film looks, grain, light leak, the orange 7-segment date stamp and the doodle sample photos, all drawn on `<canvas>` (no network)
- `contracts/Booth677.sol`: the contract (Solidity ^0.8.20, no dependencies)
- `deploy.html`: one-click deploy from MetaMask, to testnet or mainnet
- `build/`: compiled ABI and bytecode, plus standard JSON input for explorer verification
- `worker/`: the public-strip upload Worker (Cloudflare, `POST /upload` → IPFS via Pinata)
- `tools/`: scripts that compile and test the contract and check the frontend against it
- `images/`: the BOT Chain logo for the footer

Libraries come from CDNs, so there is no build step: ethers.js 6.13.5, GSAP 3.12.5 + ScrollTrigger (cdnjs), and heic2any 0.0.4 (jsDelivr, loaded only when someone uploads a HEIC photo in a browser that can't open it).

## Run locally

```bash
python3 -m http.server 4610
```

Then open http://localhost:4610. The camera works on `localhost` and on HTTPS only.

Until a contract address is configured the site runs in **preview mode**: the Strip Wall is seeded with demo strips, and keeping/hearting is simulated in this browser's localStorage, so every screen can be reviewed before deploying. Without MetaMask it uses a preview wallet. Add `?reset` to start over.

## 1. Deploy the contract

Compiled with Solidity 0.8.20, optimizer 200 runs, EVM `paris`. The constructor takes no arguments.

1. Run the site locally and open http://localhost:4610/deploy.html in a browser with MetaMask.
2. Click **Deploy to BOT Chain testnet (968)** first. Open http://localhost:4610/?net=testnet: it picks up the new address automatically. Keep a private strip, a public strip, heart one, and prove an original.
3. Click **Deploy to BOT Chain mainnet (677)**.
4. Paste each address into `contract: ''` in `CONFIG.networks` at the top of `app.js`. The mainnet `contract` is the single source for the app, the footer strip and the **View on explorer** link.
5. Update the Status table above.

Or use Remix: paste `contracts/Booth677.sol` into https://remix.ethereum.org, compile with 0.8.20 and EVM version `paris`, choose *Injected Provider – MetaMask*, select **Booth677** and click **Deploy**.

| Network | Chain ID | RPC | Explorer |
|---|---|---|---|
| Testnet | 968 | https://rpc.bohr.life | https://scan.bohr.life |
| Mainnet | 677 | https://rpc.botchain.ai | https://scan.botchain.ai |

To verify the source on the explorer, use "Standard JSON input" with `build/Booth677.standard-input.json` and compiler `v0.8.20+commit.a1b79de6`. There are no constructor arguments.

## 2. Deploy the upload Worker (public strips only)

This is a copy of Resole's `/upload` Worker, adjusted for strips: up to 2400 px on the long side (Resole's is 1200), 12 MB, 20 uploads per IP per hour, and it returns the SHA-256 of the pinned bytes. Strips are PNGs drawn on a canvas with no metadata, so the pinned file is byte-for-byte the one you download and the fingerprints match.

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put PINATA_JWT
npx wrangler deploy
```

Before deploying, set `ALLOWED_ORIGINS` in `worker/wrangler.toml` to your live site origin(s), comma-separated, no trailing slash. Then paste the Worker URL plus `/upload` into `CONFIG.uploadUrl` in `app.js`.

Nothing is ever uploaded automatically: the Worker is only called after someone picks **Public** and ticks the consent box. If the upload fails, nothing is stamped on-chain and the user can retry.

## 3. Publish the site

GitHub Pages serves the repo root (no build). Push to GitHub, enable Pages, and add the custom domain under Settings → Pages (this creates `CNAME`). HTTPS is required for the camera, so tick **Enforce HTTPS**. Then add the final origin to `ALLOWED_ORIGINS` and redeploy the Worker.

Fill in `CONFIG.credits` (`x` handle and `github` repo URL) in `app.js` for the footer credits row.

## How it works

- **Booth flow:** choose 📷 Take Photo or 🖼 Upload → pick a frame (Classic strip · 2×2 · Polaroid · Handheld · Film negative · Postcard) → 4 shots with a 3 · 2 · 1 countdown, flash and shutter sound (or upload 1–4 photos, reorder, crop) → develop (Original · B&W · Sepia · Faded 90s · Cool Film · Warm Film, grain, light leak, date stamp, 30-char caption) → the strip slides out of the pickup slot → **Download PNG** (free, no wallet) or **Keep forever**.
- **Camera:** only starts after Next on the Shoot step, shows a "camera on" dot, and stops when you leave the step, scroll out of the booth or switch tabs. Photos stay mirrored like the preview; the caption and date are drawn afterwards, unmirrored.
- **Strips:** drawn at full size in the browser (long side ≤ 2400 px), exported as PNG and fingerprinted with SHA-256.
- **Keep:** `keep(imageHash, cid, frame, filter, shots, isPublic)`. Private keepsakes must have an empty `cid`; public strips must have one. The same fingerprint can only be kept once (`AlreadyKept(id)`), which makes `findByHash` unambiguous for "prove it's the original".
- **Hearts:** `heart(id)`, public strips only, once per wallet. The wall sorts by newest or most hearts.
- **Pages:** `?wall` (Strip Wall + My strips), `?strip=12` (public image, or a private proof card with a drop zone that re-hashes your PNG in the browser).
- **No edit or delete:** the contract has only `keep` and `heart` as write functions.

## Tests

```bash
npm --prefix tools install
node tools/compile.mjs
node tools/test-contract.mjs   # every rule in the contract, on an in-memory chain
node tools/check-frontend.mjs  # the ABI in app.js matches the contract; the site's calls work
npm --prefix worker install && npm --prefix worker test   # upload Worker, with Pinata stubbed
```

The booth illustration, frames, doodle sample photos and Film looks scene are original art drawn in SVG and canvas for this project.
