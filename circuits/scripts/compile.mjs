import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('build', { recursive: true });
const result = spawnSync('circom', ['credit.circom', '--O2', '--r1cs', '--wasm', '--sym', '-o', 'build'], { stdio: 'inherit' });
if (result.error || result.status !== 0) process.exit(1);
writeFileSync('build/credit_js/package.json', '{"type":"commonjs"}\n');
copyFileSync('build/credit_js/credit.wasm', 'build/credit.wasm');
