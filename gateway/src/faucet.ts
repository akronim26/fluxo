import { PublicKey } from '@solana/web3.js';
import { runCommand } from './process';
import { GatewayError } from './errors';
import { isSignature } from './app';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
type Account = { owner: PublicKey; data: Buffer };
type Options = { mint: string; rpcUrl?: string; keypairPath?: string; mintAuthorityPath?: string; connection: { getAccountInfo: (key: PublicKey) => Promise<Account | null> }; execute?: (executable: string, args: string[]) => Promise<string>; tokenExecutable?: string; solanaExecutable?: string; onSignature?: (step: string, signature: string) => void };
const faucetErrors = new Set(['faucet_not_configured', 'faucet_rpc_not_configured', 'devnet_required', 'invalid_faucet_mint', 'invalid_recipient_account', 'invalid_faucet_result', 'faucet_sol_failed_after_mint', 'faucet_failed']);
const signerPath = (path: string) => resolve(path.replace(/^~\//, `${homedir()}/`));

export function createFaucetRunner(options: { mint: string; keypairPath?: string; mintAuthorityPath?: string; workflowEnvPath: string; executable?: string; tokenExecutable?: string; solanaExecutable?: string; onSignature?: (step: string, signature: string) => void }) {
  return async (owner: string) => {
    if (!options.keypairPath) throw new GatewayError('faucet_not_configured', 503);
    const wallet = new PublicKey(owner), mint = new PublicKey(options.mint);
    const expected = PublicKey.findProgramAddressSync([wallet.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0].toBase58();
    const script = fileURLToPath(new URL('../scripts/faucet.ts', import.meta.url));
    let partial = '';
    const output = await runCommand(options.executable ?? process.execPath, ['--no-env-file', '--no-install', `--env-file=${resolve(options.workflowEnvPath)}`, script, options.mint, owner], {
      timeoutMs: 120_000,
      env: { PATH: process.env.PATH, HOME: homedir(), NO_DNA: '1', FAUCET_KEYPAIR_PATH: signerPath(options.keypairPath), FAUCET_MINT_AUTHORITY_PATH: options.mintAuthorityPath ? signerPath(options.mintAuthorityPath) : undefined, SPL_TOKEN_BIN: options.tokenExecutable, SOLANA_BIN: options.solanaExecutable },
      onStdout: chunk => {
        const lines = (partial + chunk).split('\n');
        partial = lines.pop()!.slice(-4096);
        for (const line of lines) {
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event?.event === 'faucet_transaction' && ['create_account', 'mint', 'sol_transfer'].includes(event.step) && isSignature(event.signature)) options.onSignature?.(event.step, event.signature);
        }
      },
    });
    try {
      const result = JSON.parse(output.trim().split('\n').at(-1)!);
      if (result.funded === false && faucetErrors.has(result.error)) throw new GatewayError(result.error, result.error.endsWith('_not_configured') || result.error === 'devnet_required' ? 503 : 502);
      if (result.funded !== true || result.owner !== owner || result.tokenAccount !== expected || !isSignature(result.tokenTx) || !isSignature(result.solTx) || (result.accountTx !== undefined && !isSignature(result.accountTx))) throw new Error();
      return { owner, tokenAccount: result.tokenAccount, accountTx: result.accountTx, tokenTx: result.tokenTx, solTx: result.solTx };
    } catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('invalid_faucet_result'); }
  };
}

function signatureFrom(output: string): string {
  try {
    const signatures = new Set<string>();
    const visit = (value: unknown) => {
      if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
        if (key === 'signature' && isSignature(child)) signatures.add(child);
        else if (typeof child === 'object') visit(child);
      }
    };
    visit(JSON.parse(output));
    if (signatures.size !== 1) throw new Error();
    return [...signatures][0];
  } catch { throw new GatewayError('invalid_faucet_result'); }
}

export function createFaucet(options: Options) {
  const mint = new PublicKey(options.mint);
  const execute = options.execute ?? ((executable, args) => runCommand(executable, args, { timeoutMs: 90_000 }));
  return async (owner: string) => {
    if (!options.keypairPath) throw new GatewayError('faucet_not_configured', 503);
    const wallet = new PublicKey(owner);
    const [ata] = PublicKey.findProgramAddressSync([wallet.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM);
    const account = await options.connection.getAccountInfo(mint);
    if (!account || !account.owner.equals(TOKEN_PROGRAM) || account.data.length !== 82 || account.data.readUInt32LE(0) !== 1 || account.data[44] !== 6 || account.data[45] !== 1) throw new GatewayError('invalid_faucet_mint', 503);
    const existing = await options.connection.getAccountInfo(ata);
    const common = ['--url', options.rpcUrl ?? 'devnet', '--fee-payer', options.keypairPath, '--output', 'json'];
    let accountTx: string | undefined;
    if (existing) {
      if (!existing.owner.equals(TOKEN_PROGRAM) || existing.data.length !== 165 || !existing.data.subarray(0, 32).equals(mint.toBuffer()) || !existing.data.subarray(32, 64).equals(wallet.toBuffer()) || existing.data[108] !== 1) throw new GatewayError('invalid_recipient_account', 503);
    } else {
      accountTx = signatureFrom(await execute(options.tokenExecutable ?? 'spl-token', ['create-account', options.mint, '--owner', owner, ...common]));
      options.onSignature?.('create_account', accountTx);
    }
    const tokenTx = signatureFrom(await execute(options.tokenExecutable ?? 'spl-token', ['mint', options.mint, '20', ata.toBase58(), '--mint-authority', options.mintAuthorityPath ?? options.keypairPath, ...common]));
    options.onSignature?.('mint', tokenTx);
    try {
      const solTx = signatureFrom(await execute(options.solanaExecutable ?? 'solana', ['transfer', owner, '0.02', '--from', options.keypairPath, '--allow-unfunded-recipient', ...common]));
      options.onSignature?.('sol_transfer', solTx);
      return { owner, tokenAccount: ata.toBase58(), accountTx, tokenTx, solTx };
    } catch { throw new GatewayError('faucet_sol_failed_after_mint'); }
  };
}
