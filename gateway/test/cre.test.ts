import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createCreRunner, parseSimulationResult } from '../src/cre';

test('simulation result is decoded from its final marker, never from a misleading log', () => {
  expect(parseSimulationResult('log {"txStatus":"SUCCESS"}\nWorkflow Simulation Result:\n"{\\"txStatus\\":\\"FAILED\\"}"')).toEqual({ txStatus: 'FAILED' });
  expect(() => parseSimulationResult('spend SUCCESS tx=anything')).toThrow();
  expect(() => parseSimulationResult('Workflow Simulation Result:\n{}\nWorkflow Simulation Result:\n{}')).toThrow();
});

test('combined runner broadcasts exactly once with prebuilt WASM and default limits, and cleans its payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brizo-cre-test-'));
  try {
    const fake = join(root, 'cre');
    await writeFile(fake, `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'fake.mjs')}" "$@"\n`, { mode: 0o700 });
    await mkdir(join(root, 'build'));
    const wasm = join(root, 'build/brizo-request.wasm');
    await writeFile(wasm, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    await writeFile(join(root, 'fake.mjs'), `import { readFileSync } from 'node:fs';const args=process.argv.slice(2);const p=JSON.parse(readFileSync(args[args.indexOf('--http-payload')+1],'utf8'));if(args[2]!=='./brizo-request'||args.filter(a=>a==='--broadcast').length!==1||args.includes('--limits')||args[args.indexOf('--wasm')+1]!==${JSON.stringify(wasm)})process.exit(2);if(!args.includes('simulation-settings')||!args.includes('--non-interactive')||!args.includes('--trigger-index'))process.exit(4);console.log('Workflow Simulation Result:');console.log(JSON.stringify(JSON.stringify({requestId:p.requestId, delivered:true, status:'delivered', spendTx:'test'})));`);
    const runtime = join(root, 'runtime');
    const run = createCreRunner({ workflowsDir: root, runtimeDir: runtime, executable: fake, timeoutMs: 10_000 });
    expect((await run('brizo-request', { requestId: '0'.repeat(32) })).requestId).toBe('0'.repeat(32));
    expect(await readdir(runtime)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('combined runner fails closed when its WASM has not been built', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brizo-no-wasm-'));
  try {
    const run = createCreRunner({ workflowsDir: root, runtimeDir: join(root, 'runtime'), executable: '/must-not-run' });
    await expect(run('brizo-request', { requestId: '0'.repeat(32) })).rejects.toThrow('request_wasm_not_built');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('only the matching public payment log is observed across chunks before failure or timeout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brizo-paid-failure-'));
  try {
    const fake = join(root, 'cre');
    await writeFile(fake, `#!/bin/sh\nexec node "${join(root, 'fake.mjs')}" "$@"\n`, { mode: 0o700 });
    await mkdir(join(root, 'build'));
    await writeFile(join(root, 'build/brizo-request.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    for (const hangs of [false, true]) {
      const signature = '3'.repeat(88), id = '0'.repeat(32);
      const observed: string[] = [];
      await writeFile(join(root, 'fake.mjs'), `console.log('request ${'1'.repeat(32)}: spend SUCCESS tx=${signature} explorer=public');console.log('request ${id}: spend SUCCESS tx=invalid explorer=public');process.stdout.write('request ${id}: spend SU');await new Promise(r=>setTimeout(r,20));console.log('CCESS tx=${signature} explorer=public');console.log('request ${id}: spend SUCCESS tx=${signature} explorer=public');${hangs ? 'setInterval(()=>{},1000);' : 'process.exit(1);'}`);
      const runtime = join(root, 'runtime');
      const run = createCreRunner({ workflowsDir: root, runtimeDir: runtime, executable: fake, timeoutMs: 1000 });
      await expect(run('brizo-request', { requestId: id }, tx => observed.push(tx))).rejects.toThrow(hangs ? 'command_timeout' : 'command_failed');
      expect(observed).toEqual([signature]);
      expect(await readdir(runtime)).toEqual([]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
