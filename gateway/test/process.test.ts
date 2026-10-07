import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/process';

test('timing out an isolated worker also stops its non-detached signing-command child', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fluxo-process-tree-'));
  let pid: number | undefined;
  try {
    const child = join(root, 'child.mjs'), worker = join(root, 'worker.ts');
    await writeFile(child, 'console.log(JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);');
    await writeFile(worker, `import {runCommand} from ${JSON.stringify(new URL('../src/process.ts', import.meta.url).href)};await runCommand(process.execPath,['--no-env-file',${JSON.stringify(child)}],{timeoutMs:5000,detached:false,onStdout:chunk=>process.stdout.write(chunk)});`);
    let partial = '';
    await expect(runCommand(process.execPath, ['--no-env-file', '--no-install', worker], { timeoutMs: 1000, onStdout: chunk => {
      partial += chunk;
      if (partial.includes('\n')) pid = JSON.parse(partial.trim()).pid;
    } })).rejects.toThrow('command_timeout');
    expect(pid).toBeNumber();
    let alive = true;
    for (let attempt = 0; attempt < 10; attempt++) {
      try { process.kill(pid!, 0); } catch { alive = false; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(alive).toBe(false);
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await rm(root, { recursive: true, force: true });
  }
});
