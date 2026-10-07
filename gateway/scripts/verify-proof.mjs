import { readFileSync } from 'node:fs';
import { groth16 } from '../../circuits/node_modules/snarkjs/main.js';
try {
  const { proof, publicSignals } = JSON.parse(readFileSync(0, 'utf8'));
  const vk = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const verified = await groth16.verify(vk, publicSignals, proof);
  console.log(JSON.stringify({ verified }));
  process.exit(0);
} catch { console.log('{"verified":false}'); process.exit(0); }
