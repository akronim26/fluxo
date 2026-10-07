import { spawn } from 'node:child_process';
import { GatewayError } from './errors';

export function runCommand(executable: string, args: string[], options: { cwd?: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; onStdout?: (chunk: string) => void; detached?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const detached = options.detached ?? process.platform !== 'win32';
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env ?? { ...process.env, NO_DNA: '1' }, stdio: ['pipe', 'pipe', 'pipe'], detached });
    let output = '', failure: GatewayError | undefined;
    const stop = (error: GatewayError) => {
      failure = error;
      try { if (detached && child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => stop(new GatewayError('command_timeout', 504)), options.timeoutMs ?? 120_000);
    const capture = (chunk: Buffer) => {
      if (output.length + chunk.length > 1_048_576) return stop(new GatewayError('command_output_limit'));
      const text = chunk.toString('utf8');
      output += text;
      try { options.onStdout?.(text); } catch { stop(new GatewayError('command_failed')); }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new GatewayError('command_unavailable', 503)); });
    child.on('close', code => { clearTimeout(timer); if (failure) reject(failure); else if (code !== 0) reject(new GatewayError('command_failed')); else resolve(output); });
    child.stdin.end(options.input);
  });
}
