// Random entropy stays inside this process; only the public contribution hash prints.
import { randomBytes } from 'node:crypto';
import { zKey } from 'snarkjs';
const [input = 'build/credit_0000.zkey', output = 'build/credit_final.zkey', name = 'Brizo lane C local contribution'] = process.argv.slice(2);
try {
  const hash = await zKey.contribute(input, output, name, randomBytes(64).toString('hex'));
  console.log(JSON.stringify({ name, input, output, contributionHash: Buffer.from(hash).toString('hex') }));
  process.exit(0);
} catch {
  console.error('Contribution failed; inspect public setup artifacts. No secret material logged.');
  process.exit(1);
}
