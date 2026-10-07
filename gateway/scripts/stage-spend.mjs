import anchor from '@coral-xyz/anchor';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function assertDevnetRpc(connection) {
  if (!(await connection.getGenesisHash()).startsWith('EtWTRABZaYq6iMfeYKouRu166VU2xqa1')) throw new Error('devnet_required');
}

export function stageErrorCode(error, idl) {
  const known = idl?.errors ?? [];
  const safe = ['stage_expired', 'stage_failed', 'devnet_required', 'relayer_not_configured'];
  if (safe.includes(error?.message) || known.some(entry => entry.name === error?.message)) return error.message;
  let code;
  const instruction = error?.InstructionError;
  if (Array.isArray(instruction) && instruction[0] === 1) code = instruction[1]?.Custom;
  const message = error?.transactionError?.message;
  if (typeof message === 'string') {
    const match = message.match(/Error processing Instruction 1: custom program error: (0x[0-9a-f]+|[0-9]+)/i);
    if (match) code = Number(match[1]);
  }
  return known.find(entry => entry.code === code)?.name ?? 'stage_refused';
}

export async function confirmStageHttp(connection, tx, lastValidBlockHeight, idl, pause = () => new Promise(resolve => setTimeout(resolve, 1000))) {
  for (;;) {
    const { value: [status] } = await connection.getSignatureStatuses([tx], { searchTransactionHistory: true });
    if (status?.err) throw new Error(stageErrorCode(status.err, idl));
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
    if (!status && (await connection.getBlockHeight('confirmed')) > lastValidBlockHeight) throw new Error('stage_expired');
    await pause();
  }
}

let stageIdl;

export function buildStageTransaction(stage, deployment, relayer, idl) {
  if (idl.address !== deployment.programId) throw new Error('stage_program_mismatch');
  const fields = [['root', 'root', 32], ['nullifierHash', 'nullifier_hash', 32], ['requestBinding', 'request_binding', 32], ['proofA', 'proof_a', 32], ['proofB', 'proof_b', 64], ['proofC', 'proof_c', 32]];
  const args = {};
  for (const [key, idlKey, size] of fields) {
    if (typeof stage[key] !== 'string' || !new RegExp(`^[0-9a-f]{${size * 2}}$`).test(stage[key])) throw new Error('invalid_stage_payload');
    args[idlKey] = [...Buffer.from(stage[key], 'hex')];
  }
  const programId = new PublicKey(deployment.programId);
  const pool = new PublicKey(deployment.pool);
  const [pending] = PublicKey.findProgramAddressSync([Buffer.from('pending'), pool.toBuffer(), Buffer.from(stage.nullifierHash, 'hex')], programId);
  const accounts = { relayer, pool, tree: new PublicKey(deployment.tree), nullifiers: new PublicKey(deployment.nullifiers), pending, system_program: SystemProgram.programId };
  const instruction = idl.instructions.find(ix => ix.name === 'stage_spend');
  if (!instruction || instruction.accounts.length !== 6) throw new Error('invalid_stage_idl');
  const ix = new TransactionInstruction({ programId, keys: instruction.accounts.map(account => ({ pubkey: accounts[account.name], isWritable: account.writable === true, isSigner: account.signer === true })), data: new anchor.BorshInstructionCoder(idl).encode('stage_spend', args) });
  return new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix);
}

async function main() {
  const permitted = new Set(['PATH', 'HOME', 'RELAYER_KEYPAIR', 'SOLANA_DEVNET_RPC_URL', 'NO_DNA']);
  for (const name of Object.keys(process.env)) if (!permitted.has(name)) delete process.env[name];
  const [stagePath, deploymentPath] = process.argv.slice(2);
  if (!stagePath || !deploymentPath || !process.env.RELAYER_KEYPAIR) throw new Error('relayer_not_configured');
  const deployment = JSON.parse(await readFile(deploymentPath, 'utf8'));
  if (deployment.cluster !== 'devnet' || deployment.rpcUrl !== 'https://api.devnet.solana.com') throw new Error('devnet_required');
  const idl = JSON.parse(await readFile(resolve(dirname(deploymentPath), '..', deployment.idl), 'utf8'));
  stageIdl = idl;
  const stage = JSON.parse(await readFile(stagePath, 'utf8'));
  const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || deployment.rpcUrl, 'confirmed');
  await assertDevnetRpc(connection);
  const signerBytes = Uint8Array.from(JSON.parse(await readFile(process.env.RELAYER_KEYPAIR, 'utf8')));
  const relayer = Keypair.fromSecretKey(signerBytes);
  try {
    const transaction = buildStageTransaction(stage, deployment, relayer.publicKey, idl);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = relayer.publicKey;
    transaction.sign(relayer);
    const tx = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 });
    await confirmStageHttp(connection, tx, lastValidBlockHeight, idl);
    console.log(JSON.stringify({ staged: true, relayer: relayer.publicKey.toBase58(), pending: transaction.instructions[1].keys[4].pubkey.toBase58(), tx }));
  } finally { signerBytes.fill(0); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.log(JSON.stringify({ staged: false, error: stageErrorCode(error, stageIdl) })); });
}
