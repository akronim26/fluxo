import { Database } from 'bun:sqlite';
import { readFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGateway, expireRequests, recoverInterruptedRequests, isSignature } from './app';
import { createCreRunner, isPrebuiltWasm } from './cre';
import { createFaucetRunner } from './faucet';
import { publicDeployment, spendConfigurationMatches, type Deployment } from './config';
import { createStager } from './stage';
import { createProofVerifier } from './verifier';
import { GatewayError } from './errors';
import { decodeBase64 } from '../../circuits/lib/protocol.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflowsDir = resolve(process.env.WORKFLOWS_DIR ?? join(root, '../workflows'));
const buildDir = resolve(root, '../circuits/build');
const runtimeDir = join(root, '.runtime');
await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
const publicPort = Number(process.env.PORT ?? 8788);
const mailboxPort = Number(process.env.MAILBOX_PORT ?? 8787);
if (![publicPort, mailboxPort].every(port => Number.isInteger(port) && port > 1024 && port < 65536) || publicPort === mailboxPort) throw new Error('invalid_gateway_ports');
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const published = await readJson(join(workflowsDir, 'enclave-public-key.json'));
decodeBase64(published.enclaveBoxPublicKey, 32);
const requestConfig = await readJson(join(workflowsDir, 'fluxo-request/config.simulation.json'));
const mailbox = new URL(requestConfig.mailboxBaseUrl);
if (mailbox.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(mailbox.hostname) || Number(mailbox.port) !== mailboxPort || mailbox.pathname !== '/' || mailbox.username || mailbox.password || mailbox.search || mailbox.hash) throw new Error('mailbox_config_must_match_local_listener');
const devnetPath = resolve(process.env.DEVNET_CONFIG_PATH ?? join(root, '../deploy/devnet.json'));
let deployment: Deployment | undefined;
if (existsSync(devnetPath)) deployment = publicDeployment(await readJson(devnetPath));
const relayerKeypairPath = process.env.RELAYER_KEYPAIR || process.env.RELAYER_KEYPAIR_PATH || undefined;
let spendReady = false;
if (deployment) {
  spendReady = Boolean(relayerKeypairPath) && spendConfigurationMatches(deployment, requestConfig) && await isPrebuiltWasm(join(workflowsDir, 'build/fluxo-request.wasm'));
}
const assets = ['credit.wasm', 'credit_final.zkey', 'verification_key.json'];
const hashes = Object.fromEntries(await Promise.all(assets.map(async name => [name, createHash('sha256').update(await readFile(join(buildDir, name))).digest('hex')])));
const publicConfig = {
  cluster: 'devnet', rpcUrl: 'https://api.devnet.solana.com', ...deployment,
  enclaveBoxPublicKey: published.enclaveBoxPublicKey,
  circuit: { wasmUrl: '/circuits/credit.wasm', zkeyUrl: '/circuits/credit_final.zkey', verificationKeyUrl: '/circuits/verification_key.json', sha256: hashes },
  ready: { spend: spendReady, faucet: Boolean(deployment && process.env.FAUCET_KEYPAIR_PATH) },
};
const dbPath = join(runtimeDir, 'gateway.sqlite');
const db = new Database(dbPath, { create: true });
await chmod(dbPath, 0o600);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
const cli = createCreRunner({ workflowsDir, runtimeDir: join(runtimeDir, 'payloads'), executable: process.env.CRE_BIN || undefined, timeoutMs: 120_000 });
const stage = deployment ? createStager({ deployment, deploymentPath: devnetPath, runtimeDir: join(runtimeDir, 'payloads'), keypairPath: relayerKeypairPath, workflowEnvPath: join(workflowsDir, '.env'), nodeExecutable: process.env.NODE_BIN || undefined, timeoutMs: 120_000 }) : undefined;
const fund = deployment ? createFaucetRunner({ mint: deployment.mint, keypairPath: process.env.FAUCET_KEYPAIR_PATH || undefined, mintAuthorityPath: process.env.FAUCET_MINT_AUTHORITY_PATH || undefined, workflowEnvPath: join(workflowsDir, '.env'), tokenExecutable: process.env.SPL_TOKEN_BIN || undefined, solanaExecutable: process.env.SOLANA_BIN || undefined,
  onSignature: (step, signature) => console.log(JSON.stringify({ event: 'faucet_transaction', step, signature })),
}) : undefined;
const gateway = createGateway({
  db, publicConfig, spendReady, faucetReady: publicConfig.ready.faucet, allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').filter(Boolean),
  verifyProof: createProofVerifier({ verifyingKey: join(buildDir, 'verification_key.json'), nodeExecutable: process.env.NODE_BIN || undefined }),
  stageSpend: async (payload, requestId) => {
    if (!spendReady || !stage) throw new GatewayError('devnet_spend_not_configured', 503);
    const result = await stage(payload, requestId);
    console.log(JSON.stringify({ event: 'stage_transaction', requestId, stageTx: result.tx, relayer: result.relayer, pending: result.pending }));
    return result;
  },
  runWorkflow: async (workflow, payload, onSpend) => {
    if (!spendReady) throw new GatewayError('devnet_spend_not_configured', 503);
    const result = await cli(workflow, payload, signature => {
      onSpend(signature);
      console.log(JSON.stringify({ event: 'spend_transaction', requestId: payload.requestId, spendTx: signature }));
    });
    if (isSignature(result.spendTx)) console.log(JSON.stringify({ workflow, requestId: payload.requestId, status: result.status, spendTx: result.spendTx }));
    return result;
  },
  fundOwner: async owner => {
    if (!fund) throw new GatewayError('faucet_not_configured', 503);
    const result = await fund(owner);
    console.log(JSON.stringify({ event: 'faucet', ...result }));
    return result;
  },
  circuitFile: async name => {
    if (!assets.includes(name)) return new Response(null, { status: 404 });
    return new Response(Bun.file(join(buildDir, name)), { headers: { 'Cache-Control': 'public, max-age=3600', ETag: `"${hashes[name]}"`, 'Content-Type': name.endsWith('.json') ? 'application/json' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } });
  },
});
const mailboxServer = Bun.serve({ hostname: '127.0.0.1', port: mailboxPort, idleTimeout: 255, fetch: gateway.mailboxApp.fetch });
const publicServer = Bun.serve({ hostname: '127.0.0.1', port: publicPort, idleTimeout: 255, fetch: (request, server) => gateway.publicApp.fetch(request, { peerIp: process.env.TRUST_CLOUDFLARE === 'true' ? request.headers.get('CF-Connecting-IP') ?? server.requestIP(request)?.address ?? 'local' : server.requestIP(request)?.address ?? 'local' }) });
recoverInterruptedRequests(db, Date.now());
console.log(JSON.stringify({ event: 'gateway_started', publicUrl: publicServer.url.toString(), mailboxUrl: mailboxServer.url.toString(), ready: publicConfig.ready }));
const sweep = setInterval(() => expireRequests(db, Date.now()), 30_000);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { clearInterval(sweep); publicServer.stop(true); mailboxServer.stop(true); db.close(); process.exit(0); });
