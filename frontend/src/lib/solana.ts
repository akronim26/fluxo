// Existing deployed IDL uses the repository's web3.js 1.98 transaction format.
// Keep legacy classes inside this boundary; UI signing uses Wallet Standard.
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { Connection, PublicKey, TransactionMessage, VersionedTransaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';
import type { WalletAccount } from '@wallet-standard/base';
import type { SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import { poseidon2 } from 'poseidon-lite/poseidon2';
import type { PublicConfig } from './api';
import { FIELD, fromHex, hex } from './crypto';
import { saveNote, type CreditNote } from './notes';
import idl from '../../../deploy/idl/brizo_pool.json';

const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const associatedProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export function connection(config: PublicConfig) { return new Connection(import.meta.env.VITE_SOLANA_RPC_URL || config.rpcUrl, 'confirmed'); }
function requireDeployment(config: PublicConfig) {
  if (!config.pool || !config.leaves || !config.tree || !config.vault || !config.mint || config.programId !== idl.address || config.tokenProgram !== tokenProgram) throw new Error('The gateway is not configured for this deployed Brizo program.');
  return { pool: config.pool, leaves: config.leaves, tree: config.tree, vault: config.vault, mint: config.mint, programId: config.programId };
}
export function decodeLeaves(data: Uint8Array): bigint[] {
  const discriminator = idl.accounts.find(a => a.name === 'Leaves')!.discriminator;
  if (data.length !== 16 + 1024 * 32 || !discriminator.every((b, i) => data[i] === b)) throw new Error('Unexpected pool leaf account.');
  const count = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(8, true);
  if (count > 1024) throw new Error('Invalid pool leaf count.');
  return Array.from({ length: count }, (_, i) => {
    const value = BigInt(`0x${hex(data.slice(16 + i * 32, 48 + i * 32))}`);
    if (value >= FIELD) throw new Error('Invalid commitment in the pool.');
    return value;
  });
}
export async function getLeaves(config: PublicConfig) {
  const d = requireDeployment(config), result = await connection(config).getAccountInfo(new PublicKey(d.leaves));
  if (!result || result.owner.toBase58() !== d.programId) throw new Error('The credit pool account could not be verified.');
  return decodeLeaves(result.data);
}
export function merklePath(leaves: bigint[], index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length || leaves.length > 1024) throw new Error('The deposit was not found in the credit pool.');
  let nodes = [...leaves], cursor = index, zero = 0n;
  const pathElements: string[] = [], pathIndices: number[] = [];
  for (let depth = 0; depth < 10; depth++) {
    pathElements.push((nodes[cursor ^ 1] ?? zero).toString()); pathIndices.push(cursor & 1);
    const next: bigint[] = [];
    for (let i = 0; i < nodes.length; i += 2) next.push(poseidon2([nodes[i], nodes[i + 1] ?? zero]));
    nodes = next; zero = poseidon2([zero, zero]); cursor = Math.floor(cursor / 2);
  }
  return { root: nodes[0].toString(), pathElements, pathIndices };
}
export async function syncNote(config: PublicConfig, note: CreditNote) {
  const leaves = await getLeaves(config), index = leaves.findIndex(v => v.toString() === note.commitment);
  if (index < 0) throw new Error('This deposit is not confirmed in the pool yet. Keep the note and try refreshing later.');
  return saveNote({ ...note, leafIndex: index });
}
export async function deposit(config: PublicConfig, note: CreditNote, account: WalletAccount, signer: SolanaSignTransactionFeature['solana:signTransaction'], status: (message: string) => void) {
  const d = requireDeployment(config), rpc = connection(config), user = new PublicKey(account.address);
  if (!account.chains.includes('solana:devnet') || !signer.supportedTransactionVersions.includes(0)) throw new Error('Choose a wallet account that supports Solana devnet and version 0 transactions.');
  const poolAccount = await rpc.getAccountInfo(new PublicKey(d.pool));
  const poolDiscriminator = idl.accounts.find(a => a.name === 'Pool')!.discriminator;
  if (!poolAccount || poolAccount.owner.toBase58() !== d.programId || poolAccount.data.length < 312 || !poolDiscriminator.every((b, i) => poolAccount.data[i] === b)) throw new Error('The deposit pool could not be verified.');
  const poolData = poolAccount.data;
  if (poolData.readBigUInt64LE(264) !== 10_000_000n || poolData.readBigUInt64LE(272) !== 200n || poolData.readBigUInt64LE(280) !== 50_000n) throw new Error('The pool pricing has changed. Deposit was stopped.');
  for (const [offset, address] of [[40,d.mint],[72,d.vault],[168,d.tree],[200,d.leaves]] as const) if (!poolData.subarray(offset,offset+32).equals(new PublicKey(address).toBuffer())) throw new Error('The pool addresses do not match the gateway configuration.');
  const [ata] = PublicKey.findProgramAddressSync([user.toBytes(), new PublicKey(tokenProgram).toBytes(), new PublicKey(d.mint).toBytes()], associatedProgram);
  const instruction = new TransactionInstruction({ programId: new PublicKey(d.programId), keys: [
    { pubkey: user, isSigner: true, isWritable: false },
    ...[d.pool,d.tree,d.leaves,ata.toBase58(),d.vault].map(a => ({ pubkey: new PublicKey(a), isSigner: false, isWritable: true })),
    { pubkey: new PublicKey(tokenProgram), isSigner: false, isWritable: false },
  ], data: Buffer.from([...idl.instructions.find(i => i.name === 'deposit')!.discriminator, ...fromHex(BigInt(note.commitment).toString(16).padStart(64,'0'))]) });
  const latest = await rpc.getLatestBlockhash();
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: latest.blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), instruction] }).compileToV0Message());
  status('Checking the deposit on Solana devnet…');
  const simulation = await rpc.simulateTransaction(transaction, { sigVerify: false });
  if (simulation.value.err) throw new Error('The deposit simulation failed. Check that your wallet has 10 tUSDC and devnet SOL for fees.');
  saveNote(note); // Save the recovery note before any signing or broadcast.
  status('Simulation passed. Confirm 10 tUSDC to the Brizo pool in your wallet.');
  const [signed] = await signer.signTransaction({ account, chain: 'solana:devnet', transaction: transaction.serialize() });
  if (!signed) throw new Error('The wallet did not return a signed transaction.');
  const signedTx = VersionedTransaction.deserialize(signed.signedTransaction);
  if (!signedTx.message.serialize().every((value, i) => value === transaction.message.serialize()[i]) || signedTx.message.serialize().length !== transaction.message.serialize().length) throw new Error('The wallet changed the deposit transaction.');
  const expectedSignature = bs58.encode(signedTx.signatures[0]);
  saveNote({ ...note, depositTx: expectedSignature }); // Recover even if broadcast times out.
  const signature = await rpc.sendRawTransaction(signed.signedTransaction, { skipPreflight: false, maxRetries: 2 });
  const submitted = saveNote({ ...note, depositTx: signature });
  status('Deposit submitted. Waiting for confirmation…');
  const result = await rpc.confirmTransaction({ ...latest, signature }, 'confirmed');
  if (result.value.err) throw new Error('The deposit was not confirmed. Your recovery note was kept; refresh it before depositing again.');
  return syncNote(config, submitted);
}
