import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProofVerifier } from '../src/verifier';

test('Node snarkjs pre-verifies the real S7 proof and rejects a changed binding', async () => {
  const sample = JSON.parse(readFileSync(new URL('../../circuits/build/sample-proof.json', import.meta.url), 'utf8'));
  const verify = createProofVerifier({ verifyingKey: fileURLToPath(new URL('../../circuits/build/verification_key.json', import.meta.url)) });
  expect(await verify(sample.proof, sample.publicSignals)).toBe(true);
  expect(await verify(sample.proof, [...sample.publicSignals.slice(0, 2), '1'])).toBe(false);
}, 20_000);
