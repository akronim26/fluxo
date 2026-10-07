# Brizo gateway (lane C)

Run from `gateway/` with Bun 1.4.2. Install with `npm ci --ignore-scripts` or
`bun install`; also install the pinned circuit dependencies with
`npm ci --ignore-scripts --prefix ../circuits` for the Node snarkjs verifier.
Run `bun test` and `bun run typecheck`.

The browser frontend is in `../frontend/` (`npm ci && npm run dev`). Its Vite
server proxies the public API and circuit assets to port 8788. See
[`frontend/README.md`](../frontend/README.md) for setup and browser checks.

Copy `.env.example` locally and fill in paths. The gateway needs no enclave
secret or model API key of its own: `WORKFLOWS_DIR` points to lane A's CRE project,
whose CLI loads its credentials. Provision signing files by hand. Application
code never logs environment values or request bodies. Only the isolated D6
signing CLI consumes `RELAYER_KEYPAIR`; faucet signing stays in the Solana CLIs.
The agent must never inspect the actual signing files or `.env`.
Use Node 23 on PATH or set `NODE_BIN` to its executable.

Before live use, lane B must provide the public `deploy/devnet.json` with
`programId`, `pool`, `tree`, `nullifiers`, `vault`, `operator`, `mint`, and `leaves`.
Alias support matches A's config helper where possible. Specify
`tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"` explicitly.
A corrected its helper's fallback in `5f19f85`. Lane A must apply the
deployment file to its Request and Settle configs. The gateway checks Request's
addresses and devnet selector before allowing CRE execution. D6 also requires
`RELAYER_KEYPAIR` to be set. Use a funded devnet keypair path (prefer absolute);
about 0.002 SOL pending-account rent is paid per request and refunded by finalize.
The earlier frontend setup's `RELAYER_KEYPAIR_PATH` is accepted as a fallback;
`RELAYER_KEYPAIR` takes precedence when both are set.
Set the private `SOLANA_DEVNET_RPC_URL` in lane A's `workflows/.env` locally.
The CRE CLI loads it there; Node's `--env-file-if-exists` loads the same file
for staging, drops unrelated credentials, and checks the devnet genesis before
signing. Gateway application code never opens that file or publishes the URL.
The isolated Bun faucet CLI loads that same RPC configuration, checks devnet,
then uses it for account reads and all SPL Token/Solana `--url` arguments.
Missing RPC configuration returns `faucet_rpc_not_configured`; there is no
public-RPC fallback in the production faucet.
Staging confirms through HTTP `getSignatureStatuses`, without WebSockets.
Known Brizo failures return their IDL names (for example `NullifierUsed` or
`UnknownRoot`); unknown diagnostics remain sanitized as `stage_refused`.
Run `bash scripts/build-wasm.sh` from that workflow directory after workflow
changes. A valid `build/brizo-request.wasm` is required for Ask readiness;
every simulation uses that prebuilt bundle with `--wasm`.

Start with `bun run start`. The public API is `http://127.0.0.1:8788` and the
private mailbox is `http://127.0.0.1:8787`, matching A's request config. Free the
mailbox port used by A's mock before starting. Tunnel only port 8788. Add the
actual frontend origin to `ALLOWED_ORIGINS`; CLI clients can omit Origin.
Enable `TRUST_CLOUDFLARE` only when a Cloudflare tunnel overwrites that header.

## API

- `GET /api/config`: validated public pool addresses, `enclaveBoxPublicKey`,
  `circuit.{wasmUrl,zkeyUrl,verificationKeyUrl,sha256}` and readiness flags.
  Resolve asset URLs relative to the gateway, not the frontend's origin.
- `POST /api/faucet {owner}`: creates an ATA if necessary, mints **20 tUSDC**
  (six decimals), then transfers **0.02 devnet SOL**. CLI signing uses opaque
  keypair paths and confirmed transactions. Optional separate mint authority.
- `POST /api/ask {requestId,ciphertext,nonce,clientPub,proof,publicSignals}`:
  strict canonical encoding, decoded-byte binding, real snarkjs verification,
  then a confirmed `stage_spend` transaction with the unchanged compressed
  proof and `setComputeUnitLimit(400_000)`. One CRE `brizo-request` receives
  `{requestId,ciphertext,nonce,clientPub,requestBinding,nullifierHash,relayer}`
  and uses `--broadcast --wasm <prebuilt bundle>` with default limits
  (no `--limits`). It seals the answer in the TEE, finalizes the staged spend
  with the same binding, and posts only after payment succeeds. Returns
  `{requestId,spendTx}` after a matching paid result with a valid 64-byte base58
  signature and the actual private callback both succeed. Sealed `model_unavailable` notices count as
  delivery; the client decrypts them.
- `GET /api/answer/:id`: 202 while working, 200 sealed answer plus `spendTx`,
  404 unknown, 410 consumed/expired, 502 failed. First successful read consumes
  the answer atomically. Poll only one client per ID.
- `POST /mailbox/:id`: **private listener only**. The ID must be in Request,
  and the nonce must equal SHA256(decoded ID || clientPub || ASCII answer)[0:24].
  Duplicate callback, unsolicited ID or wrong nonce is refused. A callback
  remains unreadable until the gateway validates the paid workflow result.

The binding is SHA256(hex-decoded 16-byte request ID || base64-decoded
ciphertext), big-endian digest modulo BN254 scalar r. snarkjs uses decimal;
Request uses 32-byte big-endian lowercase hex. There is no payload mailbox URL.

One queue serializes proof verification, staging, the combined CRE command and faucet activity.
It accepts at most 16 pending jobs. Ask is limited to 10/minute/IP; faucet is
limited to one **attempt**/hour/wallet, including partial or uncertain failures,
to avoid accidentally minting twice. Faucet transactions are separate; SOL
failure after a successful mint requires manual inspection. Public signatures
are logged as they become available.

SQLite in ignored `.runtime/` persists accepted IDs, state, rate limits and
sealed answers. IDs remain reserved permanently, including failed requests,
because A's deterministic nonce must never be reused. Answers expire after
15 minutes after callback delivery; a 30-second sweep clears ciphertext even
without a read. Queued jobs expire after 15 minutes before spending; active
workflows use CLI timeouts so a queue deadline cannot discard a paid answer. A restart
marks interrupted jobs failed and never retries a potentially broadcast stage/spend.
Confirmed staging signatures are persisted in `stage_tx`, logged as
`stage_transaction`, and included as `stageTx` in pending/failed API responses.
If finalize fails, the pending account and its rent can remain on-chain;
manually inspect the stage signature and finish the matching CRE finalize.
The matching public CRE payment-success log is persisted immediately as
`spendTx`, so a later delivery failure/timeout/restart retains both signatures.
That log is recovery metadata and never releases an answer. A timeout before
payment is reported can leave the outcome unknown. Inspect on-chain state
before any manual recovery.
No automatic retry creates a new stage or charges the same credit again.
CLI payload files are mode 0600 and removed after every invocation; secret keys
and raw questions are never written there. Runtime directory is mode 0700.
The faucet's signing commands inherit its isolated worker process group, so
the outer request deadline also stops an active command before the queue advances.

Limits: gateway/host operators can spoof the loopback callback and can possess
the enclave key under the project's threat model. A CLI timeout can occur after
a chain broadcast; do not automatically retry that credit. Long queues can
outlast the HTTP connection; keep the original ID and poll its status. The
simulator uses D6's 65-byte binding-aware Spend report within the default report limit.
Simulation evidence still does not demonstrate production DON deployment.

Lane B's public devnet deployment and D6 IDL have been imported. Live acceptance
still requires the private RPC confirmation and an end-to-end question from lane D.
Local tests use real Hono, SQLite, IDL instruction encoding and snarkjs; external CRE
and signing calls are test doubles. No live faucet or Brizo Spend signature has
been generated by lane C yet.
