// Checks that the ABI written into app.js matches the compiled contract, then drives the frontend's
// exact read and write calls against an in-memory chain with BOT Chain's chain ID (677).
// Usage (from the project root): node tools/compile.mjs && node tools/check-frontend.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory, Interface } from 'ethers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = readFileSync(join(root, 'app.js'), 'utf8');
const artifact = JSON.parse(readFileSync(join(root, 'build/Booth677.json'), 'utf8'));

// Pull the ABI array out of app.js and evaluate it as plain JS.
const start = js.indexOf('const ABI = [');
assert.ok(start >= 0, 'ABI not found in app.js');
const tupleLine = js.match(/const STRIP_TUPLE = '[^']+';/)[0];
const ABI = new Function(`${tupleLine}\n${js.slice(start, js.indexOf('];', start) + 2)}\nreturn ABI;`)();

// 1) Every fragment the site uses must exist in the compiled contract with the same types.
const site = new Interface(ABI);
const real = new Interface(artifact.abi);
for (const f of site.fragments) {
  const match = real.fragments.find((r) => r.type === f.type && r.format('minimal') === f.format('minimal'));
  assert.ok(match, `app.js ${f.type} does not match the contract: ${f.format('full')}`);
}
console.log(`ABI: ${site.fragments.length} fragments match the compiled contract`);

// The frontend reads strips by index (Result has .filter/.at methods), exactly like norm() in app.js.
const normSrc = js.match(/const norm = \(s, id\) => \(\{[\s\S]+?\}\);/)[0];
const norm = new Function(`${normSrc}\nreturn norm;`)();

// 2) Run the site's calls on a chain.
const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'merge', chainId: 677 } }));
const [alice, bob] = await Promise.all([provider.getSigner(0), provider.getSigner(1)]);
const GAS = { gasLimit: 1_000_000 };
const deployed = await (await new ContractFactory(real, artifact.bytecode, alice).deploy()).waitForDeployment();
const address = await deployed.getAddress();
const asAlice = new Contract(address, ABI, alice);
const asBob = new Contract(address, ABI, bob);
const reader = new Contract(address, ABI, provider);

const sha = (s) => '0x' + createHash('sha256').update(s).digest('hex'); // the browser hashes PNG bytes the same way
const cid = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy';

// keep, like chainStore.keep: staticCall first, then send, then read the Kept event
const privArgs = [sha('private png'), '', 0, 3, 4, false];
await asAlice.keep.staticCall(...privArgs);
let receipt = await (await asAlice.keep(...privArgs, GAS)).wait();
let kept = receipt.logs.map((l) => { try { return asAlice.interface.parseLog(l); } catch { return null; } }).find((l) => l?.name === 'Kept');
assert.equal(Number(kept.args.id), 0);
receipt = await (await asBob.keep(sha('public png'), cid, 5, 1, 2, true, GAS)).wait();

// reads, exactly as chainStore does
const s0 = norm(await reader.getStrip(0), 0);
assert.deepEqual([s0.owner, s0.cid, s0.frame, s0.filter, s0.shots, s0.isPublic, s0.hearts], [alice.address, '', 0, 3, 4, false, 0]);
assert.ok(s0.at > 0);
const n = Number(await reader.publicCount());
const [ids, list] = await reader.getPublic(Math.max(0, n - 8), 8);
const wall = list.map((s, i) => norm(s, ids[i]));
assert.deepEqual(wall.map((s) => [s.id, s.cid, s.frame, s.filter]), [[1, cid, 5, 1]]);
assert.deepEqual([...(await reader.stripsOf(alice.address))].map(Number), [0]);
assert.deepEqual([...(await reader.findByHash(sha('private png')))].map((v) => (typeof v === 'bigint' ? Number(v) : v)), [true, 0]);
assert.equal((await reader.findByHash(sha('edited png')))[0], false);

// custom errors decode the way explain() / keepForever expect
await assert.rejects(reader.getStrip(9), (e) => e.revert?.name === 'StripNotFound');
await assert.rejects(asBob.keep.staticCall(...privArgs), (e) => e.revert?.name === 'AlreadyKept' && Number(e.revert.args[0]) === 0);
await assert.rejects(asBob.heart.staticCall(0), (e) => e.revert?.name === 'NotPublic');

// hearts
await (await asAlice.heart(1, GAS)).wait();
assert.equal(await reader.hearted(1, alice.address), true);
assert.equal(norm(await reader.getStrip(1), 1).hearts, 1);
await assert.rejects(asAlice.heart.staticCall(1), (e) => e.revert?.name === 'AlreadyHearted');

console.log('frontend calls work against the compiled contract');
