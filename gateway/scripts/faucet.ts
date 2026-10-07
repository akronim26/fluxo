import { Connection } from '@solana/web3.js';
import { createFaucet } from '../src/faucet';
import { GatewayError } from '../src/errors';
import { assertDevnetRpc } from './stage-spend.mjs';
import { runCommand } from '../src/process';

export function faucetEnvironment() {
  const permitted = new Set(['PATH', 'HOME', 'NO_DNA', 'SOLANA_DEVNET_RPC_URL', 'FAUCET_KEYPAIR_PATH', 'FAUCET_MINT_AUTHORITY_PATH', 'SPL_TOKEN_BIN', 'SOLANA_BIN']);
  for (const name of Object.keys(process.env)) if (!permitted.has(name)) delete process.env[name];
  if (!process.env.SOLANA_DEVNET_RPC_URL) throw new GatewayError('faucet_rpc_not_configured', 503);
  if (!process.env.FAUCET_KEYPAIR_PATH) throw new GatewayError('faucet_not_configured', 503);
  return { rpcUrl: process.env.SOLANA_DEVNET_RPC_URL, keypairPath: process.env.FAUCET_KEYPAIR_PATH, mintAuthorityPath: process.env.FAUCET_MINT_AUTHORITY_PATH || undefined, tokenExecutable: process.env.SPL_TOKEN_BIN || undefined, solanaExecutable: process.env.SOLANA_BIN || undefined };
}

async function main() {
  const options = faucetEnvironment();
  const [mint, owner] = process.argv.slice(2);
  const connection = new Connection(options.rpcUrl, 'confirmed');
  await assertDevnetRpc(connection);
  const fund = createFaucet({ ...options, mint, connection,
    execute: (executable, args) => runCommand(executable, args, { timeoutMs: 90_000, detached: false }),
    onSignature: (step, signature) => console.log(JSON.stringify({ event: 'faucet_transaction', step, signature })),
  });
  console.log(JSON.stringify({ funded: true, ...await fund(owner) }));
}

if (import.meta.main) main().catch(error => {
  const code = error instanceof GatewayError ? error.code : error?.message === 'devnet_required' ? 'devnet_required' : 'faucet_failed';
  console.log(JSON.stringify({ funded: false, error: code }));
});
