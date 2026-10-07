import { z } from 'zod';

const address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const configSchema = z.object({
  cluster: z.literal('devnet'), rpcUrl: z.string().url(),
  programId: address.optional(), pool: address.optional(), tree: address.optional(),
  leaves: address.optional(), nullifiers: address.optional(), vault: address.optional(),
  mint: address.optional(), tokenProgram: address.optional(),
  enclaveBoxPublicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  circuit: z.object({ wasmUrl: z.string(), zkeyUrl: z.string(), verificationKeyUrl: z.string(), sha256: z.record(z.string().regex(/^[a-f0-9]{64}$/)) }),
  ready: z.object({ spend: z.boolean(), faucet: z.boolean() }),
});
export type PublicConfig = z.infer<typeof configSchema>;
export const gatewayOrigin = (import.meta.env.VITE_GATEWAY_URL || '').replace(/\/$/, '');
export function apiUrl(path: string) { return `${gatewayOrigin}${path}`; }
export function assetUrl(path: string) {
  const origin = new URL(gatewayOrigin || location.origin);
  const resolved = new URL(path, origin);
  if (resolved.origin !== origin.origin) throw new Error('The gateway returned an unexpected proving-asset origin.');
  return resolved.href;
}
const messages: Record<string, string> = {
  faucet_not_configured: 'The test-token faucet is not configured on this gateway yet.',
  devnet_spend_not_configured: 'Private requests are not configured on this gateway yet.',
  rate_limited: 'The request limit was reached. The faucet allows one attempt per wallet per hour.',
  origin_refused: 'This frontend origin is not allowed by the gateway. Add it to ALLOWED_ORIGINS.',
  request_id_reused: 'This request was already submitted. It will not be sent twice.',
  answer_gone: 'This answer has already been read or has expired.',
  spend_refused: 'The credit could not be finalized on-chain. It has not been retried.',
  stage_failed: 'The on-chain proof could not be staged. Check the gateway configuration.',
  faucet_sol_failed_after_mint: 'Test tokens were minted, but the SOL transfer failed. Do not request tokens again; ask the gateway operator to check the transfer.',
};
export class ApiError extends Error {
  constructor(public status: number, public code: string, public spendTx?: string) { super(messages[code] || `The gateway could not complete this request (${code}).`); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(apiUrl(path), { ...options, signal: options.signal ?? AbortSignal.timeout(15_000), headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, cache: 'no-store' }); }
  catch { throw new Error('The gateway is unavailable. Check that it is running, then try again.'); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error || 'unavailable', body?.spendTx);
  if (body === null) throw new Error('The gateway returned an invalid response.');
  return body as T;
}
export async function getConfig() { return configSchema.parse(await api('/api/config')); }
export function explorer(signature: string) { return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`; }
