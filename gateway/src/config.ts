import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM } from './faucet';

const aliases = {
  programId: ['programId', 'program_id', 'brizoPool'], pool: ['pool', 'poolPda', 'pool_pda'],
  tree: ['tree', 'treePda'], nullifiers: ['nullifiers', 'nullifierSet', 'nullifier_set'],
  vault: ['vault'], operator: ['operator', 'operatorTokenAccount'], mint: ['mint', 'tUsdcMint', 'tusdcMint'], leaves: ['leaves', 'leavesPda'],
};
export type Deployment = Record<keyof typeof aliases, string> & { tokenProgram: string };
export function spendConfigurationMatches(deployment: Deployment, config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  const chain = (config as { solana?: Record<string, unknown> }).solana;
  return chain?.chainSelectorName === 'solana-devnet' && chain.receiverProgramId === deployment.programId && chain.pool === deployment.pool && chain.nullifiers === deployment.nullifiers;
}
export function publicDeployment(value: unknown): Deployment {
  if (!value || typeof value !== 'object') throw new Error('invalid_devnet_config');
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [name, keys] of Object.entries(aliases)) {
    const raw = keys.map(key => source[key]).find(item => typeof item === 'string');
    if (typeof raw !== 'string' || new PublicKey(raw).toBase58() !== raw) throw new Error('invalid_devnet_config');
    result[name] = raw;
  }
  if (source.cluster !== undefined && source.cluster !== 'devnet') throw new Error('devnet_required');
  if (source.tokenProgram !== undefined && source.tokenProgram !== TOKEN_PROGRAM.toBase58()) throw new Error('unsupported_token_program');
  return { ...result, tokenProgram: TOKEN_PROGRAM.toBase58() } as Deployment;
}
