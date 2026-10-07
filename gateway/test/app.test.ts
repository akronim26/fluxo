import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGateway, recoverInterruptedRequests, type Dependencies } from '../src/app';
import { requestBinding } from '../../circuits/lib/protocol.mjs';
import { GatewayError } from '../src/errors';

const sample = JSON.parse(readFileSync(new URL('../../circuits/build/sample-proof.json', import.meta.url), 'utf8'));
const signature = '3'.repeat(88); // Decodes to a 64-byte base58 test signature.
const relayer = 'FPxLpgeTVcTXcFM2ugGH5Z7M3GJ39QVDuTCvrJMDAqBL';
const staged = { relayer, tx: signature, pending: '11111111111111111111111111111111' };
const request = (id = '0'.repeat(32)) => {
  const ciphertext = Buffer.alloc(32, 7).toString('base64');
  return { requestId: id, ciphertext, nonce: Buffer.alloc(24, 7).toString('base64'), clientPub: Buffer.alloc(32, 9).toString('base64'), proof: sample.proof, publicSignals: [sample.publicSignals[0], sample.publicSignals[1], requestBinding(id, ciphertext)] };
};
const answerNonce = (body: ReturnType<typeof request>) => createHash('sha256').update(Buffer.from(body.requestId, 'hex')).update(Buffer.from(body.clientPub, 'base64')).update('answer').digest().subarray(0, 24).toString('base64');
const post = (app: any, route: string, body: unknown) => app.request(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { peerIp: '127.0.0.1' });
function setup(overrides: Partial<Dependencies> = {}) {
  const db = overrides.db ?? new Database(':memory:');
  let clock = 1000;
  const calls: string[] = [];
  let gateway: ReturnType<typeof createGateway>;
  const deps: Dependencies = { db, now: () => clock, publicConfig: { cluster: 'devnet', enclaveBoxPublicKey: 'public-only' }, verifyProof: async () => true, stageSpend: async () => staged, fundOwner: async owner => ({ owner, tokenTx: signature, solTx: signature }), runWorkflow: async (name, payload) => {
    calls.push(name);
    expect(name).toBe('brizo-request');
    const body = request(String(payload.requestId));
    const result = await post(gateway.mailboxApp, `/mailbox/${payload.requestId}`, { requestId: payload.requestId, ciphertext: Buffer.alloc(32, 3).toString('base64'), nonce: answerNonce(body) });
    expect(result.status).toBe(200);
    return { requestId: payload.requestId, delivered: true, status: 'delivered', spendTx: signature };
  }, ...overrides };
  gateway = createGateway(deps);
  return { ...gateway, db, calls, advance: (ms: number) => { clock += ms; } };
}

test('binding mismatch and invalid proof refuse before any CRE execution', async () => {
  const g = setup({ verifyProof: async () => false });
  const body = request();
  expect((await post(g.publicApp, '/api/ask', { ...body, publicSignals: [...body.publicSignals.slice(0, 2), '1'] })).status).toBe(422);
  expect((await post(g.publicApp, '/api/ask', body)).status).toBe(422);
  expect(g.calls).toEqual([]);
});
test('combined refusal, missing or invalid spend signature, and mismatched ID never release an answer', async () => {
  for (const result of [{ status: 'spend_refused', delivered: false }, { status: 'delivered', delivered: true }, { status: 'delivered', delivered: true, spendTx: 'invalid' }, { status: 'delivered', delivered: true, spendTx: signature, requestId: '1'.repeat(32) }]) {
    const calls: string[] = [];
    const g = setup({ runWorkflow: async (name, payload) => { calls.push(name); return { requestId: payload.requestId, ...result }; } });
    expect((await post(g.publicApp, '/api/ask', request())).status).toBe(502);
    expect(calls).toEqual(['brizo-request']);
    const answer = await g.publicApp.request('/api/answer/' + '0'.repeat(32));
    expect(answer.status).toBe(502);
    expect(await answer.json()).not.toHaveProperty('ciphertext');
  }
});
test('valid ask runs one combined workflow after staging and deletes the paid answer on read', async () => {
  const g = setup();
  expect((await g.publicApp.request('/api/answer/' + '0'.repeat(32))).status).toBe(404);
  const asked = await post(g.publicApp, '/api/ask', request());
  expect(asked.status).toBe(200);
  expect(await asked.json()).toEqual({ requestId: '0'.repeat(32), spendTx: signature });
  expect(g.calls).toEqual(['brizo-request']);
  const got = await g.publicApp.request('/api/answer/' + '0'.repeat(32));
  expect(got.status).toBe(200);
  expect((await got.json()).spendTx).toBe(signature);
  expect((await g.publicApp.request('/api/answer/' + '0'.repeat(32))).status).toBe(410);
  expect((await post(g.publicApp, '/api/ask', request())).status).toBe(409);
});
test('mailbox is private, cannot be injected outside a combined request or overwritten, and answer expires', async () => {
  const g = setup();
  const body = request();
  const payload = { requestId: body.requestId, ciphertext: Buffer.alloc(32, 3).toString('base64'), nonce: answerNonce(body) };
  expect((await post(g.publicApp, '/mailbox/' + body.requestId, payload)).status).toBe(404);
  expect((await post(g.mailboxApp, '/mailbox/' + body.requestId, payload)).status).toBe(404);
  expect((await post(g.publicApp, '/api/ask', body)).status).toBe(200);
  expect((await post(g.mailboxApp, '/mailbox/' + body.requestId, payload)).status).toBe(409);
  g.advance(15 * 60 * 1000);
  expect((await g.publicApp.request('/api/answer/' + body.requestId)).status).toBe(410);
});
test('queue serializes simultaneous asks and reserves duplicate IDs across recreation', async () => {
  const calls: string[] = [];
  let active = 0, maximum = 0;
  const g = setup({ stageSpend: async () => { active++; maximum = Math.max(maximum, active); calls.push('stage'); await Bun.sleep(10); active--; return staged; }, runWorkflow: async (name, payload) => { active++; maximum = Math.max(maximum, active); calls.push(name); await Bun.sleep(10); active--; return { requestId: payload.requestId, delivered: false, status: 'model_error', spendTx: signature }; } });
  const responses = await Promise.all([post(g.publicApp, '/api/ask', request('0'.repeat(32))), post(g.publicApp, '/api/ask', request('1'.repeat(32)))]);
  expect(responses.map(r => r.status)).toEqual([502, 502]);
  expect(maximum).toBe(1);
  expect(calls).toEqual(['stage', 'brizo-request', 'stage', 'brizo-request']);
  const restored = setup({ db: g.db });
  expect((await post(restored.publicApp, '/api/ask', request('0'.repeat(32)))).status).toBe(409);
});
test('rate limits asks per IP and faucet per owner, and config is explicitly public', async () => {
  const g = setup({ verifyProof: async () => false });
  for (let index = 0; index < 10; index++) expect((await post(g.publicApp, '/api/ask', request(index.toString(16).padStart(32, '0')))).status).toBe(422);
  expect((await post(g.publicApp, '/api/ask', request('f'.repeat(32)))).status).toBe(429);
  const owner = '11111111111111111111111111111111';
  expect((await post(g.publicApp, '/api/faucet', { owner })).status).toBe(200);
  expect((await post(g.publicApp, '/api/faucet', { owner })).status).toBe(429);
  g.advance(60 * 60 * 1000);
  expect((await post(g.publicApp, '/api/faucet', { owner })).status).toBe(200);
  expect(await (await g.publicApp.request('/api/config')).json()).toEqual({ cluster: 'devnet', enclaveBoxPublicKey: 'public-only' });
});

test('D6/E15 stages compressed points then passes the exact bound envelope to one combined workflow', async () => {
  let g: ReturnType<typeof setup>;
  const phases: string[] = [];
  g = setup({ verifyProof: async () => { phases.push('verify'); return true; }, stageSpend: async payload => {
      phases.push('stage');
      expect(String(payload.proofA).length).toBe(64);
      expect(String(payload.proofB).length).toBe(128);
      expect(String(payload.proofC).length).toBe(64);
      expect(Object.keys(payload).sort()).toEqual(['nullifierHash', 'proofA', 'proofB', 'proofC', 'requestBinding', 'root']);
      expect(g.db.query('SELECT state FROM requests').get()).toEqual({ state: 'staging' });
      g.advance(15 * 60 * 1000 + 1);
      expect((await g.publicApp.request('/api/answer/' + '0'.repeat(32))).status).toBe(202);
      return staged;
    }, runWorkflow: async (name, payload) => {
    phases.push(name);
    const body = request();
    expect(name).toBe('brizo-request');
    expect(payload).toEqual({ requestId: body.requestId, ciphertext: body.ciphertext, nonce: body.nonce, clientPub: body.clientPub, requestBinding: BigInt(body.publicSignals[2]).toString(16).padStart(64, '0'), nullifierHash: BigInt(sample.publicSignals[1]).toString(16).padStart(64, '0'), relayer });
    expect(g.db.query('SELECT state,stage_tx FROM requests').get()).toEqual({ state: 'requesting', stage_tx: signature });
    expect(payload).not.toHaveProperty('mailboxUrl');
    const answer = { requestId: body.requestId, ciphertext: body.ciphertext, nonce: answerNonce(body) };
    expect((await post(g.mailboxApp, '/mailbox/' + body.requestId, { ...answer, nonce: body.nonce })).status).toBe(422);
    expect((await post(g.mailboxApp, '/mailbox/' + body.requestId, answer)).status).toBe(200);
    // A client must not consume the callback before CRE confirms delivery.
    expect((await g.publicApp.request('/api/answer/' + body.requestId)).status).toBe(202);
    return { requestId: body.requestId, delivered: true, status: 'model_error', spendTx: signature };
  } });
  expect((await post(g.publicApp, '/api/ask', request())).status).toBe(200);
  expect(phases).toEqual(['verify', 'stage', 'brizo-request']);
  expect((await g.publicApp.request('/api/answer/' + '0'.repeat(32))).status).toBe(200);
});

test('invalid proof never stages, and stage refusal never finalizes or infers', async () => {
  let stages = 0;
  const stageSpend = async () => { stages++; throw new GatewayError('stage_refused'); };
  const invalid = setup({ verifyProof: async () => false, stageSpend });
  expect((await post(invalid.publicApp, '/api/ask', request())).status).toBe(422);
  expect(stages).toBe(0);
  const refused = setup({ stageSpend });
  const response = await post(refused.publicApp, '/api/ask', request());
  expect((await response.json()).error).toBe('stage_refused');
  expect(response.status).toBe(502);
  expect(stages).toBe(1);
  expect(refused.calls).toEqual([]);
  expect((await post(refused.publicApp, '/api/ask', request())).status).toBe(409);
  const reusedCredit = setup({ stageSpend: async () => { throw new GatewayError('NullifierUsed'); } });
  const replay = await post(reusedCredit.publicApp, '/api/ask', request());
  expect((await replay.json()).error).toBe('NullifierUsed');
  expect(reusedCredit.calls).toEqual([]);
});

test('failed finalize retains the confirmed stage signature for manual recovery', async () => {
  const g = setup({ runWorkflow: async (_, payload) => ({ requestId: payload.requestId, status: 'spend_refused', delivered: false, error: 'BindingMismatch' }) });
  const response = await post(g.publicApp, '/api/ask', request());
  expect(await response.json()).toEqual({ error: 'spend_refused', requestId: '0'.repeat(32), stageTx: signature });
  expect((await (await g.publicApp.request('/api/answer/' + '0'.repeat(32))).json()).stageTx).toBe(signature);
});

test('restart after queue deadline preserves staged transaction diagnostics for a fresh lifetime', async () => {
  const g = setup();
  const id = 'a'.repeat(32);
  g.db.query("INSERT INTO requests (id,state,expires,client_pub,stage_tx) VALUES (?,'requesting',999,?,?)").run(id, request(id).clientPub, signature);
  recoverInterruptedRequests(g.db, 1000);
  const response = await g.publicApp.request('/api/answer/' + id);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ requestId: id, error: 'gateway_restarted', stageTx: signature, spendTx: null });
  g.advance(15 * 60 * 1000);
  expect((await g.publicApp.request('/api/answer/' + id)).status).toBe(410);
});

test('body and origin limits refuse requests, and missing deployment does not consume faucet attempts', async () => {
  const g = setup({ allowedOrigins: ['http://localhost:5173'] });
  expect((await g.publicApp.request('/api/config', { headers: { Origin: 'https://untrusted.example' } })).status).toBe(403);
  expect((await post(g.publicApp, '/api/ask', { oversized: 'x'.repeat(81 * 1024) })).status).toBe(413);
  const disabled = setup({ faucetReady: false, spendReady: false });
  expect((await post(disabled.publicApp, '/api/faucet', { owner: '11111111111111111111111111111111' })).status).toBe(503);
  expect((await post(disabled.publicApp, '/api/ask', request())).status).toBe(503);
  expect(disabled.db.query('SELECT * FROM rate_limits').all()).toEqual([]);
});

test('a spent request can deliver after its queue deadline; answer lifetime starts at callback', async () => {
  let g: ReturnType<typeof setup>;
  g = setup({ runWorkflow: async (name, payload) => {
    expect(name).toBe('brizo-request');
    g.advance(15 * 60 * 1000 + 1);
    const body = request(String(payload.requestId));
    expect((await post(g.mailboxApp, '/mailbox/' + body.requestId, { requestId: body.requestId, ciphertext: body.ciphertext, nonce: answerNonce(body) })).status).toBe(200);
    return { requestId: body.requestId, delivered: true, status: 'delivered', spendTx: signature };
  } });
  expect((await post(g.publicApp, '/api/ask', request())).status).toBe(200);
  g.advance(15 * 60 * 1000 - 1);
  expect((await g.publicApp.request('/api/answer/' + '0'.repeat(32))).status).toBe(200);
});

test('a callback cannot be read if the combined result later refuses payment', async () => {
  let g: ReturnType<typeof setup>;
  let callbackStatus = 0, pollStatus = 0;
  g = setup({ runWorkflow: async (_, payload) => {
    const body = request(String(payload.requestId));
    callbackStatus = (await post(g.mailboxApp, '/mailbox/' + body.requestId, { requestId: body.requestId, ciphertext: body.ciphertext, nonce: answerNonce(body) })).status;
    pollStatus = (await g.publicApp.request('/api/answer/' + body.requestId)).status;
    return { requestId: body.requestId, status: 'spend_refused', delivered: false };
  } });
  expect((await post(g.publicApp, '/api/ask', request())).status).toBe(502);
  expect(callbackStatus).toBe(200);
  expect(pollStatus).toBe(202);
  const answer = await g.publicApp.request('/api/answer/' + '0'.repeat(32));
  expect(answer.status).toBe(502);
  expect(await answer.json()).not.toHaveProperty('ciphertext');
});

test('paid but undelivered requests retain both signatures and never return an answer', async () => {
  for (const [status, delivered] of [['delivered', false], ['delivered', true], ['answered', false], ['answered', true]] as const) {
    let g: ReturnType<typeof setup>, callbackStatus = 0;
    g = setup({ runWorkflow: async (_, payload) => {
      if (status === 'answered' && delivered) {
        const body = request(String(payload.requestId));
        callbackStatus = (await post(g.mailboxApp, '/mailbox/' + body.requestId, { requestId: body.requestId, ciphertext: body.ciphertext, nonce: answerNonce(body) })).status;
      }
      return { requestId: payload.requestId, status, delivered, spendTx: signature };
    } });
    const response = await post(g.publicApp, '/api/ask', request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'inference_failed', requestId: '0'.repeat(32), stageTx: signature, spendTx: signature });
    if (status === 'answered' && delivered) expect(callbackStatus).toBe(200);
  }
});

test('observed payment survives a combined command failure and restart without releasing a callback', async () => {
  let g: ReturnType<typeof setup>;
  let pending: unknown;
  g = setup({ runWorkflow: async (_, payload, onSpend) => {
    const body = request(String(payload.requestId));
    onSpend('invalid');
    onSpend(signature);
    await post(g.mailboxApp, '/mailbox/' + body.requestId, { requestId: body.requestId, ciphertext: body.ciphertext, nonce: answerNonce(body) });
    pending = await (await g.publicApp.request('/api/answer/' + body.requestId)).json();
    recoverInterruptedRequests(g.db, 1000);
    throw new GatewayError('command_timeout', 504);
  } });
  const response = await post(g.publicApp, '/api/ask', request());
  expect(pending).toMatchObject({ status: 'delivered', stageTx: signature, spendTx: signature });
  expect(pending).not.toHaveProperty('ciphertext');
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({ error: 'command_timeout', requestId: '0'.repeat(32), stageTx: signature, spendTx: signature });
  expect(await (await g.publicApp.request('/api/answer/' + '0'.repeat(32))).json()).not.toHaveProperty('ciphertext');
});
