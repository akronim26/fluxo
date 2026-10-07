import { test, expect } from 'bun:test';
import { PublicKey } from '@solana/web3.js';
import { createFaucet, createFaucetRunner, TOKEN_PROGRAM } from '../src/faucet';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/process';

const mint = 'So11111111111111111111111111111111111111112';
const owner = '11111111111111111111111111111111';
const signature = '3'.repeat(88);
function options(decimals = 6, existing = false) {
  const calls: { executable: string; args: string[] }[] = [];
  const mintData = Buffer.alloc(82); mintData.writeUInt32LE(1); mintData[44] = decimals; mintData[45] = 1;
  const tokenData = Buffer.alloc(165); new PublicKey(mint).toBuffer().copy(tokenData); new PublicKey(owner).toBuffer().copy(tokenData, 32); tokenData[108] = 1;
  return { calls, config: { mint, keypairPath: '/opaque/signer-not-read.json', connection: { getAccountInfo: async (key: PublicKey) => key.toBase58() === mint ? { owner: TOKEN_PROGRAM, data: mintData } : existing ? { owner: TOKEN_PROGRAM, data: tokenData } : null }, execute: async (executable: string, args: string[]) => { calls.push({ executable, args }); return JSON.stringify({ transactionData: { signature } }); } } };
}
test('faucet account creation, minting and SOL transfer all use the configured RPC URL', async () => {
  const o = options();
  const rpcUrl = 'https://devnet.example.invalid';
  const result = await createFaucet({ ...o.config, rpcUrl })(owner);
  expect(o.calls.length).toBe(3);
  for (const call of o.calls) expect(call.args[call.args.indexOf('--url') + 1]).toBe(rpcUrl);
  expect(JSON.stringify(result)).not.toContain(rpcUrl);
});
test('faucet creates the ATA, mints exactly 20 tUSDC and sends 0.02 devnet SOL using opaque CLI signing', async () => {
  const o = options();
  const result = await createFaucet(o.config)(owner);
  expect(o.calls.length).toBe(3);
  expect(o.calls[0].args.slice(0, 3)).toEqual(['create-account', mint, '--owner']);
  expect(o.calls[1].args.slice(0, 3)).toEqual(['mint', mint, '20']);
  expect(o.calls[2].args.slice(0, 3)).toEqual(['transfer', owner, '0.02']);
  for (const call of o.calls) { expect(call.args).toContain('devnet'); expect(call.args).toContain('/opaque/signer-not-read.json'); expect(call.args).not.toContain('--skip-preflight'); }
  expect(result.tokenTx).toBe(signature);
  expect(result.solTx).toBe(signature);
});
test('faucet rejects wrong mint decimals before any transaction and reuses an existing ATA', async () => {
  const bad = options(9);
  await expect(createFaucet(bad.config)(owner)).rejects.toThrow('invalid_faucet_mint');
  expect(bad.calls).toEqual([]);
  const existing = options(6, true);
  await createFaucet(existing.config)(owner);
  expect(existing.calls.length).toBe(2);
});

test('isolated faucet runner loads the workflow RPC through CLI args and emits only validated public metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fluxo-faucet-runner-'));
  try {
    const executable = join(root, 'bun');
    const progress: unknown[] = [];
    await writeFile(executable, `#!/bin/sh\nexec "${process.execPath}" --no-env-file "${join(root, 'fake.mjs')}" -- "$@"\n`, { mode: 0o700 });
    await writeFile(join(root, 'fake.mjs'), `const a=process.argv.slice(2);if(a[0]!=='--no-env-file'||a[1]!=='--no-install'||a[2]!==${JSON.stringify('--env-file=' + join(root, 'workflows/.env'))}||!a[3].endsWith('/scripts/faucet.ts')||a[4]!==${JSON.stringify(mint)}||a[5]!==${JSON.stringify(owner)}||process.env.FAUCET_KEYPAIR_PATH!=='/opaque/faucet.json'||process.env.OPENROUTER_API_KEY||process.env.ENCLAVE_BOX_SECRET)process.exit(2);console.log(JSON.stringify({event:'faucet_transaction',step:'mint',signature:${JSON.stringify(signature)}}));console.log(JSON.stringify({funded:false,error:'faucet_sol_failed_after_mint'}));`);
    const run = createFaucetRunner({ mint, keypairPath: '/opaque/faucet.json', workflowEnvPath: join(root, 'workflows/.env'), executable, onSignature: (step, signature) => progress.push({ step, signature }) });
    await expect(run(owner)).rejects.toThrow('faucet_sol_failed_after_mint');
    expect(progress).toEqual([{ step: 'mint', signature }]);
    await writeFile(join(root, 'fake.mjs'), `console.log(JSON.stringify({funded:false,error:'private RPC diagnostic must not escape'}));`);
    await expect(run(owner)).rejects.toThrow('invalid_faucet_result');
    await writeFile(join(root, 'fake.mjs'), `console.log(JSON.stringify({funded:true,owner:${JSON.stringify(owner)},tokenAccount:'aqxoAhCwpy3oB1BpNw9hL1HdLYLgPpbPjzxDrrQj3Fs',tokenTx:${JSON.stringify(signature)},solTx:${JSON.stringify(signature)},rpcUrl:'must-not-escape'}));`);
    expect(await run(owner)).toEqual({ owner, tokenAccount: 'aqxoAhCwpy3oB1BpNw9hL1HdLYLgPpbPjzxDrrQj3Fs', accountTx: undefined, tokenTx: signature, solTx: signature });
    await writeFile(join(root, 'fake.mjs'), `console.log(JSON.stringify({funded:true,owner:${JSON.stringify(owner)},tokenAccount:'11111111111111111111111111111111',tokenTx:${JSON.stringify(signature)},solTx:${JSON.stringify(signature)}}));`);
    await expect(run(owner)).rejects.toThrow('invalid_faucet_result');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Bun explicitly loads the synthetic RPC fixture while faucet removes unrelated credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fluxo-faucet-env-'));
  try {
    const file = join(root, 'rpc.fixture');
    const script = join(root, 'check.ts');
    await writeFile(file, 'SOLANA_DEVNET_RPC_URL=https://devnet.example.invalid\nOPENROUTER_API_KEY=placeholder\nENCLAVE_BOX_SECRET=placeholder\n');
    await writeFile(script, `import { faucetEnvironment } from ${JSON.stringify(new URL('../scripts/faucet.ts', import.meta.url).href)};try{const o=faucetEnvironment();console.log(JSON.stringify({rpcMatches:o.rpcUrl==='https://devnet.example.invalid',credentialsRemoved:!process.env.OPENROUTER_API_KEY&&!process.env.ENCLAVE_BOX_SECRET}));}catch(e){console.log(JSON.stringify({error:e.code}));}`);
    const run = () => runCommand(process.execPath, ['--no-env-file', '--no-install', `--env-file=${file}`, script], { env: { PATH: process.env.PATH, HOME: process.env.HOME, FAUCET_KEYPAIR_PATH: '/opaque/faucet.json' } });
    expect(JSON.parse(await run())).toEqual({ rpcMatches: true, credentialsRemoved: true });
    await writeFile(file, '');
    expect(JSON.parse(await run())).toEqual({ error: 'faucet_rpc_not_configured' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
