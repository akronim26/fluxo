import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { groth16 } from 'snarkjs';
import { buildBn128 } from 'ffjavascript';

after(async () => { await (await buildBn128()).terminate(); });

test('fixture proof verifies, and tampering each public input is rejected', async () => {
  const load = async name => JSON.parse(await readFile(new URL(`../build/${name}`, import.meta.url), 'utf8'));
  const fixture = await load('sample-proof.json').catch(() => null);
  assert.ok(fixture, 'Generate S7 proof fixture before testing');
  const vk = await load('verification_key.json');
  assert.equal(vk.nPublic, 3);
  assert.equal(await groth16.verify(vk, fixture.publicSignals, fixture.proof), true);
  for (let index = 0; index < 3; index++) {
    const changed = [...fixture.publicSignals];
    changed[index] = String(BigInt(changed[index]) + 1n);
    assert.equal(await groth16.verify(vk, changed, fixture.proof), false);
  }
});
