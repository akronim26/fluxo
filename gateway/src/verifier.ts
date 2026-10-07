import { fileURLToPath } from 'node:url';
import { runCommand } from './process';
import { GatewayError } from './errors';

export function createProofVerifier(options: { verifyingKey: string; nodeExecutable?: string }) {
  return async (proof: unknown, publicSignals: string[]) => {
    const output = await runCommand(options.nodeExecutable ?? 'node', [fileURLToPath(new URL('../scripts/verify-proof.mjs', import.meta.url)), options.verifyingKey], {
      input: JSON.stringify({ proof, publicSignals }), timeoutMs: 10_000, env: { PATH: process.env.PATH },
    });
    try { const value = JSON.parse(output); if (typeof value.verified !== 'boolean') throw new Error(); return value.verified; }
    catch { throw new GatewayError('verifier_unavailable', 503); }
  };
}
