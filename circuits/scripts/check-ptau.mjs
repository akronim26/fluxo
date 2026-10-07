import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const expected = 'ded2694169b7b08e898f736d5de95af87c3f1a64594013351b1a796dbee393bd825f88f9468c84505ddd11eb0b1465ac9b43b9064aa8ec97f2b73e04758b8a4a';
const actual = createHash('blake2b512').update(readFileSync('build/powersOfTau28_hez_final_12.ptau')).digest('hex');
assert.equal(actual, expected, 'Public ptau does not match snarkjs README digest');
console.log('Public ptau BLAKE2b-512 verified');
