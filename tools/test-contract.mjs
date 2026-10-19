// Runs the compiled contract on an in-memory chain: keep (private + public) → heart → reads, plus every rule in the PRD.
// Usage (from the project root): node tools/compile.mjs && node tools/test-contract.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, ZeroHash, id as keccak } from 'ethers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { abi, bytecode } = JSON.parse(readFileSync(join(root, 'build/Booth677.json'), 'utf8'));

const provider = new BrowserProvider(
  ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'merge', chainId: 677 }, wallet: { defaultBalance: 1000 } }),
);
const [alice, bob, carol] = await Promise.all([0, 1, 2].map((i) => provider.getSigner(i)));
const GAS = { gasLimit: 1_000_000 };

assert.deepEqual(new ContractFactory(abi, bytecode).interface.deploy.inputs, [], 'constructor takes no arguments');
const booth = await (await new ContractFactory(abi, bytecode, alice).deploy()).waitForDeployment();
const as = (signer) => booth.connect(signer);
const events = (receipt) => receipt.logs.map((l) => booth.interface.parseLog(l)).filter(Boolean);
const reverts = (call, name) => assert.rejects(call, (e) => e.revert?.name === name, `expected ${name}`);

const H = (s) => keccak(s); // any non-zero bytes32 stands in for a SHA-256 here
const CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy';

// --- keep: validation ----------------------------------------------
await reverts(as(alice).keep.staticCall(ZeroHash, '', 0, 0, 4, false), 'EmptyHash');
await reverts(as(alice).keep.staticCall(H('a'), '', 6, 0, 4, false), 'BadFrame');
await reverts(as(alice).keep.staticCall(H('a'), '', 0, 6, 4, false), 'BadFilter');
await reverts(as(alice).keep.staticCall(H('a'), '', 0, 0, 0, false), 'BadShots');
await reverts(as(alice).keep.staticCall(H('a'), '', 0, 0, 5, false), 'BadShots');
await reverts(as(alice).keep.staticCall(H('a'), '', 0, 0, 4, true), 'CidRequired');
await reverts(as(alice).keep.staticCall(H('a'), CID, 0, 0, 4, false), 'CidNotAllowed');
await reverts(as(alice).keep.staticCall(H('a'), 'x'.repeat(101), 0, 0, 4, true), 'CidTooLong');

// --- keep: private + public ----------------------------------------
let r = await (await as(alice).keep(H('private-1'), '', 0, 2, 4, false, GAS)).wait();
console.log(`keep (private) gas: ${r.gasUsed}`);
assert.deepEqual([...events(r)[0].args], [0n, alice.address, false]);
r = await (await as(bob).keep(H('public-1'), CID, 3, 1, 2, true, GAS)).wait();
console.log(`keep (public) gas: ${r.gasUsed}`);
assert.deepEqual([...events(r)[0].args], [1n, bob.address, true]);
await (await as(alice).keep(H('public-2'), CID + 'b', 5, 5, 4, true, GAS)).wait();
assert.equal(await booth.total(), 3n);
assert.equal(await booth.publicCount(), 2n);

await reverts(as(carol).keep.staticCall(H('public-1'), '', 0, 0, 4, false), 'AlreadyKept');

let s = await booth.getStrip(0);
assert.deepEqual([s.owner, s.imageHash, s.cid, s.frame, s[4], s.shots, s.isPublic, s.hearts], [alice.address, H('private-1'), '', 0n, 2n, 4n, false, 0n]);
assert.ok(s[8] > 0n);
s = await booth.getStrip(1);
assert.deepEqual([s.owner, s.cid, s.frame, s[4], s.shots, s.isPublic], [bob.address, CID, 3n, 1n, 2n, true]);
await reverts(booth.getStrip.staticCall(9), 'StripNotFound');
assert.equal((await booth.strips(1)).cid, CID, 'strips(i) getter is public');

// --- reads ---------------------------------------------------------
assert.deepEqual([...(await booth.stripsOf(alice.address))], [0n, 2n]);
assert.deepEqual([...(await booth.stripsOf(carol.address))], []);
assert.deepEqual([...(await booth.findByHash(H('public-2')))], [true, 2n]);
assert.deepEqual([...(await booth.findByHash(H('nope')))], [false, 0n]);

let [ids, list] = await booth.getPublic(0, 10);
assert.deepEqual([...ids], [1n, 2n]);
assert.deepEqual(list.map((x) => x.cid), [CID, CID + 'b']);
[ids] = await booth.getPublic(1, 10);
assert.deepEqual([...ids], [2n]);
[ids] = await booth.getPublic(5, 10);
assert.deepEqual([...ids], []);
[ids] = await booth.getPublic(0, 1);
assert.deepEqual([...ids], [1n]);

// --- hearts ---------------------------------------------------------
await reverts(as(bob).heart.staticCall(0), 'NotPublic');
await reverts(as(bob).heart.staticCall(9), 'StripNotFound');
r = await (await as(alice).heart(1, GAS)).wait();
console.log(`heart gas: ${r.gasUsed}`);
assert.deepEqual([...events(r)[0].args], [1n, alice.address, 1n]);
await reverts(as(alice).heart.staticCall(1), 'AlreadyHearted');
await (await as(bob).heart(1, GAS)).wait(); // owners may heart their own strip
await (await as(carol).heart(1, GAS)).wait();
assert.equal((await booth.getStrip(1)).hearts, 3n);
assert.equal(await booth.hearted(1, carol.address), true);
assert.equal(await booth.hearted(2, carol.address), false);

// --- no edit / delete / admin functions exist ------------------------
const writes = booth.interface.fragments.filter((f) => f.type === 'function' && !f.constant).map((f) => f.name).sort();
assert.deepEqual(writes, ['heart', 'keep']);

console.log('all contract rules pass');
