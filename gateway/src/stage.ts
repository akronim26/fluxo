import type { Deployment } from './config';
import type { proofToSolanaCompressed } from '../../circuits/lib/protocol.mjs';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import { isSignature } from './app';
import { runCommand } from './process';
import { GatewayError } from './errors';
import idl from '../../deploy/idl/fluxo_pool.json';
const stageErrors = new Set([...idl.errors.map(entry => entry.name), 'stage_refused', 'stage_expired', 'stage_failed', 'devnet_required', 'relayer_not_configured']);
export type StagePayload = ReturnType<typeof proofToSolanaCompressed>;
export type StageResult = { relayer: string; pending: string; tx: string };
export function createStager(options: { deploymentPath: string; runtimeDir: string; deployment: Deployment; keypairPath?: string; workflowEnvPath?: string; nodeExecutable?: string; timeoutMs?: number }) {
  return async (payload: StagePayload, requestId: string): Promise<StageResult> => {
    if (!options.keypairPath) throw new GatewayError('relayer_not_configured', 503);
    if (!/^[0-9a-f]{32}$/.test(requestId)) throw new GatewayError('invalid_request', 400);
    const runtime = resolve(options.runtimeDir);
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(runtime, `${requestId}-stage-`));
    const fixture = join(directory, 'stage.json');
    try {
      await writeFile(fixture, JSON.stringify(payload), { mode: 0o600 });
      const script = fileURLToPath(new URL('../scripts/stage-spend.mjs', import.meta.url));
      let output: string;
      try {
        const args = [script, fixture, resolve(options.deploymentPath)];
        if (options.workflowEnvPath) args.unshift(`--env-file-if-exists=${resolve(options.workflowEnvPath)}`);
        output = await runCommand(options.nodeExecutable ?? 'node', args, {
          timeoutMs: options.timeoutMs, env: { PATH: process.env.PATH, HOME: homedir(), NO_DNA: '1', RELAYER_KEYPAIR: resolve(options.keypairPath.replace(/^~\//, `${homedir()}/`)) },
        });
      } catch (error) {
        if (error instanceof GatewayError && error.code !== 'command_failed') throw error;
        throw new GatewayError('stage_refused');
      }
      try {
        const result = JSON.parse(output.trim());
        if (result.staged === false && stageErrors.has(result.error)) throw new GatewayError(result.error);
        const expected = PublicKey.findProgramAddressSync([Buffer.from('pending'), new PublicKey(options.deployment.pool).toBuffer(), Buffer.from(payload.nullifierHash, 'hex')], new PublicKey(options.deployment.programId))[0].toBase58();
        if (result.staged !== true || !isSignature(result.tx) || new PublicKey(result.relayer).toBase58() !== result.relayer || result.pending !== expected) throw new Error();
        return { relayer: result.relayer, pending: result.pending, tx: result.tx };
      } catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('invalid_stage_result'); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
}
