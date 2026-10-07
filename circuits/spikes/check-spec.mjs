// Reproducible diagnostic only; never generates setup keys or handles secrets.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = mkdtempSync(join(tmpdir(), 'brizo-s7-spec-'));
const original = readFileSync(fileURLToPath(new URL('./spec-probe.circom', import.meta.url)), 'utf8');
const r = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
function run(command, args, success = true) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    assert.ifError(result.error);
    if (success) assert.equal(result.status, 0, result.stdout + result.stderr);
    else assert.notEqual(result.status, 0, 'Expected command to fail');
    return result.stdout + result.stderr;
}
function compile(name, source, success = true) {
    const path = join(directory, `${name}.circom`);
    writeFileSync(path, source);
    return run('circom', [path, '--r1cs', '--wasm', '--sym', '-o', directory], success);
}
function witness(name, index, success = true) {
    const input = join(directory, 'input.json');
    const output = join(directory, `${name}.wtns`);
    writeFileSync(input, JSON.stringify({ requestBinding: '123', i: String(index) }));
    const text = run(process.execPath, [join(directory, `${name}_js/generate_witness.js`), join(directory, `${name}_js/${name}.wasm`), input, output], success);
    if (success) {
        const checked = run('snarkjs', ['wtns', 'check', join(directory, `${name}.r1cs`), output]);
        assert.match(checked, /WITNESS IS CORRECT/);
    }
    return text;
}

assert.match(compile('original', original, false), /Non quadratic constraints/);
console.log('CONFIRMED: SPEC binding tautology does not compile in circom 2.2.3.');
const candidate = original.replace(
    'requestBinding * requestBinding === requestBinding * requestBinding;',
    'signal bindingSquare;\n    bindingSquare <== requestBinding * requestBinding;',
);
compile('candidate', candidate);
witness('candidate', r - 1n);
console.log('CONFIRMED: comparator without i range constraint accepts i = r - 1.');
run('snarkjs', ['r1cs', 'export', 'json', join(directory, 'candidate.r1cs'), join(directory, 'candidate.json')]);
const constraints = JSON.parse(readFileSync(join(directory, 'candidate.json'), 'utf8')).constraints;
assert.ok(constraints.some(row => row.some(linear => Object.hasOwn(linear, '1'))));
console.log('PROBE ONLY: private bindingSquare retains the public binding in R1CS.');
const bounded = candidate.replace('signal bits[9];', `signal bits[9];
    signal indexBits[8];
    var indexValue = 0;
    for (var k = 0; k < 8; k++) {
        indexBits[k] <-- (i >> k) & 1;
        indexBits[k] * (indexBits[k] - 1) === 0;
        indexValue += indexBits[k] * (1 << k);
    }
    indexValue === i;`);
compile('bounded', bounded);
for (const index of [0n, 199n]) witness('bounded', index);
for (const index of [200n, 256n, r - 1n]) assert.match(witness('bounded', index, false), /Assert Failed/);
console.log('PROBE ONLY: 8-bit i constraint accepts 0 and 199; rejects 200, 256, r - 1.');
console.log('S7 remains BLOCKED pending shared SPEC correction; no production circuit or keys generated.');
