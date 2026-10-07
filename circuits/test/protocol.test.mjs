import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestBinding, proofToSolana, proofToSolanaCompressed, scalarHex } from '../lib/protocol.mjs';
import { readFileSync } from 'node:fs';

test('binding hashes decoded request ID and ciphertext bytes using approved vector', () => {
  assert.equal(requestBinding('000102030405060708090a0b0c0d0e0f', 'aGVsbG8='), '12591868490619502940983479717201964167859440711926496621633181383191911195486');
  assert.throws(() => requestBinding('../escape', 'aGVsbG8='));
  assert.throws(() => requestBinding('000102030405060708090a0b0c0d0e0f', 'aGVsbG8'));
});

test('compressed Spend is byte-identical to native Solana compression fixture', () => {
  const sample = JSON.parse(readFileSync(new URL('../build/sample-proof.json', import.meta.url), 'utf8'));
  const native = JSON.parse(readFileSync(new URL('../build/sample-spend-compressed.json', import.meta.url), 'utf8'));
  assert.deepEqual({ requestId: sample.requestId, ...proofToSolanaCompressed(sample.proof, sample.publicSignals) }, native);
});
test('Solana conversion negates A in base field and reverses each G2 component pair', () => {
  const proof = { pi_a: ['1', '2', '1'], pi_b: [['3', '4'], ['5', '6'], ['1', '0']], pi_c: ['7', '8', '1'], protocol: 'groth16', curve: 'bn128' };
  const encoded = proofToSolana(proof, ['1', '2', '3']);
  assert.equal(encoded.proofA, '0'.repeat(63) + '1' + '30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd45');
  assert.equal(encoded.proofB, [4, 3, 6, 5].map(x => x.toString(16).padStart(64, '0')).join(''));
  assert.equal(encoded.proofC, [7, 8].map(x => x.toString(16).padStart(64, '0')).join(''));
  assert.equal(encoded.root, '1'.padStart(64, '0'));
  assert.throws(() => scalarHex('21888242871839275222246405745257275088548364400416034343698204186575808495617'));
  assert.throws(() => proofToSolana({ ...proof, pi_a: ['1', '2', '0'] }, ['1', '2', '3']));
});
