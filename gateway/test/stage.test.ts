import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStager } from '../src/stage';
import { publicDeployment } from '../src/config';
import deployed from '../../deploy/devnet.json';
import fixture from '../../circuits/build/sample-spend-compressed.json';
import idl from '../../deploy/idl/fluxo_pool.json';
import { ComputeBudgetInstruction, PublicKey } from '@solana/web3.js';
import { buildStageTransaction, assertDevnetRpc, confirmStageHttp, stageErrorCode } from '../scripts/stage-spend.mjs';
import { SendTransactionError } from '@solana/web3.js';

const { requestId, ...payload } = fixture;
const signature = '3'.repeat(88);
const relayer = 'FPxLpgeTVcTXcFM2ugGH5Z7M3GJ39QVDuTCvrJMDAqBL';
const pending = 'ArTuf56LcZcLsgTMb6N4GgrwMNLU6ULxBay3piiGdU4W';

test('D6 staging instruction matches the deployed IDL, compressed bytes and 400,000 CU budget', () => {
  const tx = buildStageTransaction(payload, deployed, new PublicKey(relayer), idl);
  expect(tx.instructions.length).toBe(2);
  expect(ComputeBudgetInstruction.decodeSetComputeUnitLimit(tx.instructions[0]).units).toBe(400_000);
  const ix = tx.instructions[1];
  expect(ix.programId.toBase58()).toBe(deployed.programId);
  expect(ix.data).toEqual(Buffer.concat([Buffer.from([148, 30, 136, 14, 117, 213, 138, 36]), ...['root', 'nullifierHash', 'requestBinding', 'proofA', 'proofB', 'proofC'].map(k => Buffer.from(payload[k as keyof typeof payload], 'hex'))]));
  expect(ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
    [relayer, true, true], [deployed.pool, false, false], [deployed.tree, false, false], [deployed.nullifiers, false, false], [pending, false, true], ['11111111111111111111111111111111', false, false],
  ]);
  expect(() => buildStageTransaction({ ...payload, proofA: 'aa' }, deployed, new PublicKey(relayer), idl)).toThrow('invalid_stage_payload');
  expect(() => buildStageTransaction(payload, deployed, new PublicKey(relayer), { ...idl, address: pending })).toThrow('stage_program_mismatch');
});

test('stage CLI consumes the workflow RPC env opaquely; adapter validates its result and cleans public proof files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fluxo-stage-test-'));
  try {
    const fake = join(root, 'node');
    await writeFile(fake, `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'fake.mjs')}" "$@"\n`, { mode: 0o700 });
    await writeFile(join(root, 'fake.mjs'), `import {readFileSync,statSync} from 'node:fs';const a=process.argv.slice(2);const flag=a.shift();const p=JSON.parse(readFileSync(a[1],'utf8'));if(flag!==${JSON.stringify('--env-file-if-exists=' + join(root, 'workflows/.env'))}||!a[0].endsWith('/scripts/stage-spend.mjs')||a[2]!==${JSON.stringify(join(root, 'devnet.json'))}||Object.keys(p).length!==6||p.proofA.length!==64||p.proofB.length!==128||p.proofC.length!==64||(statSync(a[1]).mode&511)!==384||process.env.RELAYER_KEYPAIR!=='/opaque/relayer.json'||process.env.ENCLAVE_BOX_SECRET||process.env.OPENROUTER_API_KEY)process.exit(2);console.log(JSON.stringify({staged:true,relayer:${JSON.stringify(relayer)},pending:${JSON.stringify(pending)},tx:${JSON.stringify(signature)}}));`);
    const run = createStager({ deployment: publicDeployment(deployed), deploymentPath: join(root, 'devnet.json'), runtimeDir: join(root, 'runtime'), keypairPath: '/opaque/relayer.json', workflowEnvPath: join(root, 'workflows/.env'), nodeExecutable: fake, timeoutMs: 10_000 });
    expect(await run(payload, requestId)).toEqual({ relayer, pending, tx: signature });
    expect(await readdir(join(root, 'runtime'))).toEqual([]);
    await writeFile(join(root, 'fake.mjs'), `console.log(JSON.stringify({staged:true,relayer:${JSON.stringify(relayer)},pending:'11111111111111111111111111111111',tx:${JSON.stringify(signature)}}));`);
    await expect(run(payload, requestId)).rejects.toThrow('invalid_stage_result');
    expect(await readdir(join(root, 'runtime'))).toEqual([]);
    await writeFile(join(root, 'fake.mjs'), `console.log(JSON.stringify({staged:false,error:'NullifierUsed'}));`);
    await expect(run(payload, requestId)).rejects.toThrow('NullifierUsed');
    await writeFile(join(root, 'fake.mjs'), `console.log(JSON.stringify({staged:false,error:'private RPC diagnostic must not escape'}));`);
    await expect(run(payload, requestId)).rejects.toThrow('invalid_stage_result');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('HTTP confirmation waits for confirmed status even when a processed transaction outlives its blockhash', async () => {
  const statuses = [null, { err: null, confirmationStatus: 'processed' }, { err: null, confirmationStatus: 'confirmed' }];
  let pauses = 0, checks = 0;
  const connection = {
    getSignatureStatuses: async (ids: string[], config: unknown) => {
      expect(ids).toEqual([signature]); expect(config).toEqual({ searchTransactionHistory: true });
      checks++;
      return { value: [statuses.shift()] };
    },
    getBlockHeight: async () => checks === 1 ? 9 : 11,
  };
  await confirmStageHttp(connection, signature, 10, idl, async () => { pauses++; });
  expect(checks).toBe(3);
  expect(pauses).toBe(2);
});

test('HTTP confirmation rejects unknown expired transactions and names Fluxo instruction errors', async () => {
  const connection = (status: unknown) => ({ getSignatureStatuses: async () => ({ value: [status] }), getBlockHeight: async () => 11 });
  await expect(confirmStageHttp(connection(null), signature, 10, idl)).rejects.toThrow('stage_expired');
  await expect(confirmStageHttp(connection({ err: { InstructionError: [1, { Custom: 6006 }] }, confirmationStatus: 'confirmed' }), signature, 10, idl)).rejects.toThrow('NullifierUsed');
});

test('only IDL errors on the Fluxo instruction escape preflight diagnostics', () => {
  const error = new SendTransactionError({ action: 'simulate', signature: '', transactionMessage: 'Transaction simulation failed: Error processing Instruction 1: custom program error: 0x1776', logs: ['private diagnostic'] });
  expect(stageErrorCode(error, idl)).toBe('NullifierUsed');
  expect(stageErrorCode({ InstructionError: [0, { Custom: 6006 }] }, idl)).toBe('stage_refused');
  expect(stageErrorCode({ InstructionError: [1, { Custom: 9999 }] }, idl)).toBe('stage_refused');
  expect(stageErrorCode(new Error('private RPC diagnostic'), idl)).toBe('stage_refused');
});

test('private RPC must identify devnet before any staging signature is sent', async () => {
  await expect(assertDevnetRpc({ getGenesisHash: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' })).resolves.toBeUndefined();
  await expect(assertDevnetRpc({ getGenesisHash: async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' })).rejects.toThrow('devnet_required');
});

test('missing relayer configuration refuses without running a signing command', async () => {
  const run = createStager({ deployment: publicDeployment(deployed), deploymentPath: '/public/devnet.json', runtimeDir: '/unused', nodeExecutable: '/must-not-run' });
  await expect(run(payload, requestId)).rejects.toThrow('relayer_not_configured');
});
