import { buildPoseidon } from 'circomlibjs';
import { groth16 } from 'snarkjs';
import { readFile, writeFile } from 'node:fs/promises';
import { proofToSolana, proofToSolanaCompressed, requestBinding, verifyingKeyRust } from '../lib/protocol.mjs';

const poseidon = await buildPoseidon();
const hash = (a, b) => poseidon.F.toObject(poseidon([a, b]));
const requestId = '000102030405060708090a0b0c0d0e0f';
const ciphertext = 'aGVsbG8=';
const commitment = hash(123n, 456n);
let root = commitment, zero = 0n;
const pathElements = [], zeros = ['0'];
for (let level = 0; level < 10; level++) {
  pathElements.push(String(zero));
  root = hash(root, zero);
  zero = hash(zero, zero);
  zeros.push(String(zero));
}
const input = { secret: '123', nk: '456', pathElements, pathIndices: Array(10).fill('0'), i: '0', root: String(root), nullifierHash: String(hash(456n, 0n)), requestBinding: requestBinding(requestId, ciphertext) };
const start = performance.now();
const { proof, publicSignals } = await groth16.fullProve(input, 'build/credit.wasm', 'build/credit_final.zkey');
const provingMs = Math.round(performance.now() - start);
const vk = JSON.parse(await readFile('build/verification_key.json', 'utf8'));
if (!await groth16.verify(vk, publicSignals, proof)) throw new Error('Proof did not verify');
if (publicSignals.join(',') !== [input.root, input.nullifierHash, input.requestBinding].join(',')) throw new Error('Public input order mismatch');
const solana = proofToSolana(proof, publicSignals);
const write = (name, value) => writeFile(`build/${name}`, JSON.stringify(value, null, 2) + '\n');
await write('sample-proof.json', { synthetic: true, requestId, ciphertext, proof, publicSignals, solana });
await write('sample-spend.json', { requestId, ...solana });
await write('sample-spend-compressed.json', { requestId, ...proofToSolanaCompressed(proof, publicSignals) });
await write('poseidon-vectors.json', { zeros, commitment: String(commitment), nullifierHash: input.nullifierHash, root: input.root, testInputs: { commitment: ['123', '456'], nullifier: ['456', '0'] } });
await writeFile('../programs/programs/fluxo_pool/src/vk.rs', verifyingKeyRust(vk));
console.log(JSON.stringify({ provingMs, verified: true, underFiveSeconds: provingMs < 5000 }));
process.exit(provingMs < 5000 ? 0 : 1);
