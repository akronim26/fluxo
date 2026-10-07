import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildPoseidon } from 'circomlibjs';

const require = createRequire(import.meta.url);
const poseidon = await buildPoseidon();
const hash = (a, b) => poseidon.F.toObject(poseidon([a, b]));
const r = poseidon.F.p;

async function fixture(index = 0n) {
  // Synthetic test values, never a funded credit note.
  let current = hash(123n, 456n);
  let zero = 0n;
  const pathElements = [];
  for (let depth = 0; depth < 10; depth++) {
    pathElements.push(String(zero));
    current = hash(current, zero);
    zero = hash(zero, zero);
  }
  return { secret: '123', nk: '456', pathElements, pathIndices: Array(10).fill('0'), i: String(index), root: String(current), nullifierHash: String(hash(456n, index)), requestBinding: '1234' };
}

test('credit witness enforces membership, boolean path indices and 0..199 credit range', async () => {
  const wasm = new URL('../build/credit_js/credit.wasm', import.meta.url);
  assert.ok(await readFile(wasm).catch(() => null), 'Compile the credit circuit before testing');
  const builder = require('../build/credit_js/witness_calculator.js');
  const calculator = await builder(await readFile(wasm));
  for (const index of [0n, 199n]) await calculator.calculateWitness(await fixture(index), true);
  for (const index of [200n, 256n, r - 1n]) await assert.rejects(calculator.calculateWitness(await fixture(index), true), /Assert Failed/);
  for (const replacement of [{ root: '1' }, { nullifierHash: '1' }, { secret: '124' }, { pathIndices: ['2', ...Array(9).fill('0')] }, { pathElements: ['1', ...Array(9).fill('0')] }]) {
    await assert.rejects(calculator.calculateWitness({ ...await fixture(), ...replacement }, true), /Assert Failed/);
  }
});
