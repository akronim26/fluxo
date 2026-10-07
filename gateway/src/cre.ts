import { mkdir, mkdtemp, writeFile, rm, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runCommand } from './process';
import { GatewayError } from './errors';
import { isSignature } from './app';

export function parseSimulationResult(output: string): Record<string, unknown> {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const parts = clean.split('Workflow Simulation Result:');
  if (parts.length !== 2) throw new GatewayError('invalid_simulation_result');
  try {
    let result: unknown = JSON.parse(parts[1].trim().split(/\r?\n/)[0]);
    if (typeof result === 'string') result = JSON.parse(result);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch { throw new GatewayError('invalid_simulation_result'); }
}

export async function isPrebuiltWasm(path: string): Promise<boolean> {
  try {
    const file = await open(path, 'r');
    try {
      const header = Buffer.alloc(8);
      const { bytesRead } = await file.read(header, 0, 8, 0);
      return bytesRead === 8 && header.equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    } finally { await file.close(); }
  } catch { return false; }
}

export function createCreRunner(options: { workflowsDir: string; runtimeDir: string; executable?: string; timeoutMs?: number }) {
  return async (workflow: 'fluxo-request', payload: Record<string, unknown>, onSpend?: (signature: string) => void) => {
    if (typeof payload.requestId !== 'string' || !/^[0-9a-f]{32}$/.test(payload.requestId)) throw new GatewayError('invalid_request', 400);
    const wasm = join(resolve(options.workflowsDir), 'build/fluxo-request.wasm');
    if (!await isPrebuiltWasm(wasm)) throw new GatewayError('request_wasm_not_built', 503);
    const runtime = resolve(options.runtimeDir);
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(runtime, `${payload.requestId}-`));
    const fixture = join(directory, `${payload.requestId}-request.json`);
    try {
      await writeFile(fixture, JSON.stringify(payload), { mode: 0o600 });
      const args = ['workflow', 'simulate', `./${workflow}`, '--target', 'simulation-settings', '--non-interactive', '--trigger-index', '0', '--http-payload', fixture];
      args.push('--broadcast', '--wasm', wasm);
      let partial = '', observed = false;
      const payment = new RegExp(`\\brequest ${payload.requestId}: spend SUCCESS tx=([1-9A-HJ-NP-Za-km-z]{64,88})\\s`);
      return parseSimulationResult(await runCommand(options.executable ?? 'cre', args, {
        cwd: options.workflowsDir, timeoutMs: options.timeoutMs,
        onStdout: chunk => {
          const lines = (partial + chunk).split('\n');
          partial = lines.pop()!.slice(-4096);
          for (const line of lines) {
            const signature = line.match(payment)?.[1];
            if (!observed && isSignature(signature)) {
              observed = true;
              onSpend?.(signature);
            }
          }
        },
      }));
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
}
