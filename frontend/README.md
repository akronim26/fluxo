# Brizo frontend

Vite + React frontend adapted from [Optimus](https://v0-optimus-delta.vercel.app/):
Instrument Sans and JetBrains Mono, warm neutral surfaces, a grid and rotating
ASCII globe, oversized type, numbered features, a dark process section,
developer tabs, pricing and responsive navigation. Components and illustrations
are locally implemented. Fonts are bundled locally; no tracking or remote fonts.

The landing page opens the integrated workspace at `/#app`. This directory is
the new frontend; no previous frontend existed in this checkout.

## Run locally

Use Node 23+ for gateway staging (the frontend requires Node 22.12+) and Bun for
the gateway. From the repository root:

```sh
npm ci --prefix frontend
npm ci --ignore-scripts --prefix gateway
npm ci --ignore-scripts --prefix circuits
```

Run `bun run start` inside `gateway/` and `npm run dev` inside `frontend/` in
separate terminals. Open **http://127.0.0.1:5173**. Vite proxies `/api` and
`/circuits` to the public gateway on 8788. Never expose private mailbox port 8787.
The landing page and rules-only privacy preview work without the gateway.

## Live configuration

See `gateway/.env.example` and `gateway/README.md`. The operator must configure
the CRE environment, CLI login and matching enclave/model credentials. Set the
funded devnet relayer's absolute path in `RELAYER_KEYPAIR`; the earlier
`RELAYER_KEYPAIR_PATH` name remains a fallback. Set `SOLANA_DEVNET_RPC_URL` in the
configured workflow directory's local `.env` and run `bash scripts/build-wasm.sh`
from that directory to build `build/brizo-request.wasm`. The faucet also needs
`FAUCET_KEYPAIR_PATH` and optionally `FAUCET_MINT_AUTHORITY_PATH`. Do not put
secrets in any `VITE_*` variable.

The browser reads public readiness flags; it never reports unconfigured request
or faucet services as ready. The UI and local preview can be reviewed without
signer paths or model credentials.

## Integration

- Wallet Standard discovery and connection; no wallet-specific injection.
- The Solana adapter retains web3.js 1.98.4 compatibility and imports the shared
  deployment IDL. It checks account owner, discriminator, addresses and pricing,
  simulates before wallet signing, and persists the note and signed transaction
  ID before broadcasting. Deposits are **10 tUSDC for 200 credits** on devnet.
- Credit notes remain in localStorage. Backups use AES-GCM and PBKDF2. Restore
  validates commitments and pool membership configuration and never rolls back
  a locally reserved credit index. Chain inclusion is checked before proving.
- Privacy rules remove known profile values, emails, phone/ID numbers and dates
  on the device. Optional Ollama rewrites with local `qwen3:8b`, then runs the
  rules again. Ollama must allow the frontend origin. No remote fallback.
- NaCl box seals the approved text. The SHA-256 binding matches the existing
  circuit. A Web Worker runs real snarkjs Groth16 proving after verifying the
  gateway-provided WASM and zkey hashes.
- A Web Lock serializes credit spending across tabs. Credits are reserved before
  submission, and uncertain submissions are never automatically retried.
- Only ciphertext, public signals and proof go to `/api/ask`. The browser checks
  the answer nonce, authenticates/decrypts the reply, and applies supported typed
  age/city branches locally. Model output is rendered as text.
- Gateway follows HANDOFF-A D6/E15: pre-verify → relayer `stage_spend` → one
  combined CRE `brizo-request` invocation. It seals the answer, finalizes the
  bound spend, and delivers a single-use encrypted answer after payment succeeds.
  Requests use the prebuilt WASM bundle and CRE's default limits.

## Build and hosting

Run `npm run build` in this directory and publish `frontend/dist` on a static
host. `npm run preview` serves the build locally. Build from the full repository
so `deploy/idl/brizo_pool.json` is available.

Set `VITE_GATEWAY_URL` at build time to the public HTTPS gateway origin and add
the frontend origin to gateway `ALLOWED_ORIGINS`. Alternatively reverse-proxy
`/api` and `/circuits` on the same origin. The Vite development proxy is not part
of the static build. The hash route needs no SPA redirect. Use HTTPS for Web
Crypto, Web Locks and wallet support. `VITE_SOLANA_RPC_URL` optionally overrides
the devnet RPC with a public client endpoint; frontend variables are public.

## Verification

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an installed Chromium binary.
Browser tests serve the production build. They cover 320/390/768/1024/1440px,
navigation, failed gateway connections, wallet dismissal, consent invalidation,
tampered assets, a real browser proof and encrypted reply, a simulated wallet
deposit, backup export, and axe accessibility checks. RPC, faucet and model
responses use controlled fixtures; proof and cryptographic operations are real.
Gateway checks: `bun test` and `npm run typecheck` in `gateway/`.

## Limits

This is a devnet demo. It does not implement WebLLM, question splitting,
medical-band inference or Tor. Scrubbing is best-effort and requires review;
rules-only mode does not hide writing style. The gateway sees IPs and timing.
Payment privacy depends on the depositor pool. The team that provisioned the
enclave key could decrypt intercepted scrubbed requests. CRE runs in simulation;
cryptography is unaudited with a single-party phase 2 setup.

Keep the tab open during a request: ephemeral answer keys stay in memory, so
reloading loses the ability to decrypt an in-flight answer. Notes survive reload.
Uncertain spends are not automatically retried or refunded. The credit count is
based on local notes, not a chain scan of all nullifiers; old backups can include
spent credits, which the program rejects.

A live wallet → relayer → CRE/model run requires the operator's credentials and
signer paths. Automated fixtures are not evidence of a live transaction.
