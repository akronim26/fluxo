import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { decodeBase64, proofToSolanaCompressed, requestBinding } from '../../circuits/lib/protocol.mjs';
import { GatewayError } from './errors';
import type { StagePayload, StageResult } from './stage';
export type Dependencies = {
  db: Database;
  verifyProof: (proof: unknown, signals: string[]) => Promise<boolean>;
  stageSpend: (payload: StagePayload, requestId: string) => Promise<StageResult>;
  runWorkflow: (workflow: 'fluxo-request', payload: Record<string, unknown>, onSpend: (signature: string) => void) => Promise<Record<string, unknown>>;
  fundOwner: (owner: string) => Promise<Record<string, unknown>>;
  publicConfig: Record<string, unknown>;
  now?: () => number;
  allowedOrigins?: string[];
  circuitFile?: (name: string) => Promise<Response>;
  spendReady?: boolean;
  faucetReady?: boolean;
  // Forwards one JSON-RPC request to the private devnet RPC (key stays server-side).
  rpcProxy?: (request: { jsonrpc: string; id: unknown; method: string; params?: unknown }) => Promise<Response>;
};
type Row = { id: string; state: string; expires: number; client_pub: string; stage_tx: string | null; spend_tx: string | null; ciphertext: string | null; nonce: string | null; error: string | null };
const idSchema = z.string().regex(/^[0-9a-f]{32}$/);
// The Solana methods the app calls (frontend/src/lib/solana.ts), nothing else.
export const RPC_METHODS = new Set(['getAccountInfo', 'getLatestBlockhash', 'simulateTransaction', 'sendTransaction', 'getSignatureStatuses', 'getBlockHeight', 'getGenesisHash', 'getHealth']);
const rpcRequestSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number(), z.null()]), method: z.string(), params: z.array(z.unknown()).optional() }).strict();
const askSchema = z.object({ requestId: idSchema, ciphertext: z.string(), nonce: z.string(), clientPub: z.string(), proof: z.unknown(), publicSignals: z.array(z.string()).length(3) }).strict();
const mailboxSchema = z.object({ requestId: idSchema, ciphertext: z.string(), nonce: z.string() }).strict();
const lifetime = 15 * 60 * 1000;
export function recoverInterruptedRequests(db: Database, at: number) {
  return db.query("UPDATE requests SET state = 'failed', ciphertext = NULL, nonce = NULL, error = 'gateway_restarted', expires = ? WHERE state IN ('queued', 'staging', 'requesting', 'spending', 'inferring', 'delivered')").run(at + lifetime);
}

export function expireRequests(db: Database, at: number) {
  return db.query("UPDATE requests SET state = 'expired', ciphertext = NULL, nonce = NULL WHERE expires <= ? AND state IN ('queued', 'delivered', 'answered', 'failed')").run(at);
}

export function isSignature(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(alphabet.indexOf(char));
  const leading = value.match(/^1*/)?.[0].length ?? 0;
  const bytes = number === 0n ? 0 : Math.ceil(number.toString(16).length / 2);
  return leading + bytes === 64;
}

function envelopeBytes(ciphertext: string, nonce: string, clientPub?: string) {
  if (decodeBase64(ciphertext).length < 16) throw new Error('Missing box MAC');
  decodeBase64(nonce, 24);
  if (clientPub !== undefined) decodeBase64(clientPub, 32);
}

export function createGateway(dependencies: Dependencies) {
  const { db } = dependencies;
  const now = dependencies.now ?? Date.now;
  db.exec(`CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, state TEXT NOT NULL, expires INTEGER NOT NULL, client_pub TEXT NOT NULL, spend_tx TEXT, ciphertext TEXT, nonce TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets INTEGER NOT NULL);`);
  if (!db.query<{ name: string }, []>('PRAGMA table_info(requests)').all().some(column => column.name === 'stage_tx')) db.exec('ALTER TABLE requests ADD COLUMN stage_tx TEXT');
  const lookup = (id: string) => db.query<Row, [string]>('SELECT * FROM requests WHERE id = ?').get(id);
  const expire = () => expireRequests(db, now());
  const rate = db.transaction((key: string, limit: number, window: number) => {
    db.query('DELETE FROM rate_limits WHERE resets <= ?').run(now());
    const row = db.query<{ count: number }, [string]>('SELECT count FROM rate_limits WHERE key = ?').get(key);
    if (row && row.count >= limit) throw new GatewayError('rate_limited', 429);
    db.query('INSERT INTO rate_limits(key, count, resets) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1').run(key, now() + window);
  });
  let pending = 0;
  let tail = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    pending++;
    const result = tail.then(work);
    tail = result.then(() => {}, () => {});
    return result.finally(() => { pending--; });
  };
  const publicApp = new Hono<{ Bindings: { peerIp?: string } }>();
  const mailboxApp = new Hono<{ Bindings: { peerIp?: string } }>();
  for (const app of [publicApp, mailboxApp]) {
    app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
    app.use('*', bodyLimit({ maxSize: 80 * 1024, onError: c => c.json({ error: 'body_too_large' }, 413) }));
    app.onError((error, c) => error instanceof GatewayError ? c.json({ error: error.code }, error.status) : c.json({ error: 'internal_error' }, 502));
  }
  if (dependencies.allowedOrigins) {
    const origins = dependencies.allowedOrigins;
    publicApp.use('*', async (c, next) => {
      const origin = c.req.header('Origin');
      if (origin && !origins.includes(origin)) return c.json({ error: 'origin_refused' }, 403);
      await next();
    });
    publicApp.use('*', cors({ origin: origin => origins.includes(origin) ? origin : '', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
  }
  publicApp.get('/api/config', c => c.json(dependencies.publicConfig));
  // Browser → Solana reads and the deposit send go through here, so the private RPC key
  // never ships in the app bundle. Only the methods the app uses are forwarded.
  publicApp.post('/api/rpc', async c => {
    if (!dependencies.rpcProxy) throw new GatewayError('rpc_not_configured', 503);
    rate(`rpc:${c.env?.peerIp ?? 'local'}`, 240, 60_000);
    const raw = await c.req.text();
    if (raw.length > 16_384) throw new GatewayError('rpc_request_too_large', 413);
    let request: unknown;
    try { request = JSON.parse(raw); } catch { throw new GatewayError('invalid_rpc_request', 400); }
    const parsed = rpcRequestSchema.safeParse(request);
    if (!parsed.success || !RPC_METHODS.has(parsed.data.method)) throw new GatewayError('rpc_method_not_allowed', 400);
    return dependencies.rpcProxy(parsed.data);
  });
  if (dependencies.circuitFile) publicApp.get('/circuits/:name', c => dependencies.circuitFile!(c.req.param('name')));
  publicApp.post('/api/faucet', async c => {
    if (dependencies.faucetReady === false) throw new GatewayError('faucet_not_configured', 503);
    const parsed = z.object({ owner: z.string() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new GatewayError('invalid_owner', 400);
    const { owner } = parsed.data;
    try { if (new PublicKey(owner).toBase58() !== owner) throw new Error(); } catch { throw new GatewayError('invalid_owner', 400); }
    if (pending >= 16) throw new GatewayError('queue_full', 503);
    rate(`faucet:${owner}`, 1, 60 * 60 * 1000);
    return c.json(await serialized(() => dependencies.fundOwner(owner)));
  });
  publicApp.post('/api/ask', async c => {
    if (dependencies.spendReady === false) throw new GatewayError('devnet_spend_not_configured', 503);
    rate(`ask:${c.env?.peerIp ?? 'local'}`, 10, 60_000);
    const parsed = askSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new GatewayError('invalid_request', 400);
    const body = parsed.data;
    let spend: ReturnType<typeof proofToSolanaCompressed>;
    try {
      envelopeBytes(body.ciphertext, body.nonce, body.clientPub);
      spend = proofToSolanaCompressed(body.proof, body.publicSignals);
      if (requestBinding(body.requestId, body.ciphertext) !== body.publicSignals[2]) throw new Error();
    } catch { throw new GatewayError('invalid_proof_or_binding', 422); }
    if (pending >= 16) throw new GatewayError('queue_full', 503);
    const reserved = db.query("INSERT INTO requests(id, state, expires, client_pub) VALUES (?, 'queued', ?, ?) ON CONFLICT(id) DO NOTHING").run(body.requestId, now() + lifetime, body.clientPub);
    if (!reserved.changes) throw new GatewayError('request_id_reused', 409);
    try {
      await serialized(async () => {
        expire();
        if (lookup(body.requestId)?.state === 'expired') throw new GatewayError('request_expired', 410);
        if (!await dependencies.verifyProof(body.proof, body.publicSignals)) throw new GatewayError('invalid_proof', 422);
        expire();
        if (lookup(body.requestId)?.state === 'expired') throw new GatewayError('request_expired', 410);
        db.query("UPDATE requests SET state = 'staging' WHERE id = ?").run(body.requestId);
        const stage = await dependencies.stageSpend(spend, body.requestId);
        if (!isSignature(stage.tx)) throw new GatewayError('invalid_stage_result');
        try { if (new PublicKey(stage.relayer).toBase58() !== stage.relayer) throw new Error(); } catch { throw new GatewayError('invalid_stage_result'); }
        db.query("UPDATE requests SET state = 'requesting', stage_tx = ? WHERE id = ?").run(stage.tx, body.requestId);
        const result = await dependencies.runWorkflow('fluxo-request', { requestId: body.requestId, ciphertext: body.ciphertext, nonce: body.nonce, clientPub: body.clientPub, requestBinding: spend.requestBinding, nullifierHash: spend.nullifierHash, relayer: stage.relayer }, signature => {
          if (isSignature(signature)) db.query("UPDATE requests SET spend_tx = ? WHERE id = ? AND state IN ('requesting', 'delivered')").run(signature, body.requestId);
        });
        if (result.requestId !== body.requestId || !['delivered', 'model_error', 'answered'].includes(String(result.status)) || !isSignature(result.spendTx)) throw new GatewayError('spend_refused');
        db.query('UPDATE requests SET spend_tx = ? WHERE id = ?').run(result.spendTx, body.requestId);
        expire();
        if (result.status === 'answered' || result.delivered !== true || lookup(body.requestId)?.state !== 'delivered') throw new GatewayError('inference_failed');
        db.query("UPDATE requests SET state = 'answered' WHERE id = ?").run(body.requestId);
      });
      return c.json({ requestId: body.requestId, spendTx: lookup(body.requestId)!.spend_tx });
    } catch (error) {
      const failure = error instanceof GatewayError ? error : new GatewayError('request_failed');
      db.query("UPDATE requests SET state = CASE WHEN state = 'expired' THEN state ELSE 'failed' END, ciphertext = NULL, nonce = NULL, error = ?, expires = ? WHERE id = ?").run(failure.code, now() + lifetime, body.requestId);
      const row = lookup(body.requestId);
      return c.json({ error: failure.code, requestId: body.requestId, stageTx: row?.stage_tx ?? undefined, spendTx: row?.spend_tx ?? undefined }, failure.status);
    }
  });
  mailboxApp.post('/mailbox/:id', async c => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) throw new GatewayError('invalid_request', 400);
    expire();
    const row = lookup(id);
    if (!row) throw new GatewayError('unknown_request', 404);
    if (row.state === 'expired') throw new GatewayError('request_expired', 410);
    if (row.state !== 'requesting') throw new GatewayError('mailbox_refused', 409);
    const parsed = mailboxSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || parsed.data.requestId !== id) throw new GatewayError('invalid_answer', 422);
    const body = parsed.data;
    try {
      envelopeBytes(body.ciphertext, body.nonce);
      const expected = createHash('sha256').update(Buffer.from(id, 'hex')).update(Buffer.from(row.client_pub, 'base64')).update('answer').digest().subarray(0, 24).toString('base64');
      if (body.nonce !== expected) throw new Error();
    } catch { throw new GatewayError('invalid_answer', 422); }
    const updated = db.query("UPDATE requests SET state = 'delivered', ciphertext = ?, nonce = ?, expires = ? WHERE id = ? AND state = 'requesting'").run(body.ciphertext, body.nonce, now() + lifetime, id);
    if (!updated.changes) throw new GatewayError('mailbox_refused', 409);
    return c.json({ accepted: true });
  });
  const takeAnswer = db.transaction((id: string) => {
    expire();
    const row = lookup(id);
    if (row?.state === 'answered') db.query("UPDATE requests SET state = 'consumed', ciphertext = NULL, nonce = NULL WHERE id = ?").run(id);
    return row;
  });
  publicApp.get('/api/answer/:id', c => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) throw new GatewayError('invalid_request', 400);
    const row = takeAnswer(id);
    if (!row) throw new GatewayError('unknown_request', 404);
    if (['expired', 'consumed'].includes(row.state)) throw new GatewayError('answer_gone', 410);
    if (row.state === 'failed') return c.json({ requestId: id, error: row.error, stageTx: row.stage_tx, spendTx: row.spend_tx }, 502);
    if (row.state !== 'answered') return c.json({ requestId: id, status: row.state, stageTx: row.stage_tx, spendTx: row.spend_tx }, 202);
    return c.json({ requestId: id, ciphertext: row.ciphertext, nonce: row.nonce, spendTx: row.spend_tx });
  });
  return { publicApp, mailboxApp };
}
