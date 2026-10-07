import { test, expect } from 'bun:test';
import { publicDeployment, spendConfigurationMatches } from '../src/config';
const address = '11111111111111111111111111111111';
const deployment = Object.fromEntries(['programId', 'pool', 'tree', 'nullifiers', 'vault', 'operator', 'mint', 'leaves'].map(key => [key, address]));
test('public config keeps only validated devnet addresses and uses the real token program', () => {
  const result = publicDeployment({ ...deployment, cluster: 'devnet', unexpected: 'must-not-be-exposed' });
  expect(result).not.toHaveProperty('unexpected');
  expect(result.tokenProgram).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  expect(() => publicDeployment({ ...deployment, cluster: 'mainnet-beta' })).toThrow();
  expect(() => publicDeployment({ ...deployment, mint: 'invalid' })).toThrow();
  expect(() => publicDeployment({ ...deployment, tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBjXRSaH9FuK7Pzi' })).toThrow();
});

test('D6 readiness accepts the deployed finalize config without tree or custom limits', () => {
  const d = publicDeployment(deployment);
  const config = { solana: { chainSelectorName: 'solana-devnet', receiverProgramId: address, pool: address, nullifiers: address } };
  expect(spendConfigurationMatches(d, config)).toBe(true);
  expect(spendConfigurationMatches(d, { solana: { ...config.solana, pool: 'wrong' } })).toBe(false);
  expect(spendConfigurationMatches(d, { solana: { ...config.solana, chainSelectorName: 'solana-mainnet' } })).toBe(false);
});
