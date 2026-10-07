# Testing Fluxo

All commands run from the repository root unless a `cd` says otherwise.

## Prerequisites

- Node 23, Bun ≥ 1.2.21, Solana CLI 2.3.0, Anchor 0.31.0 (+ `nightly-2025-04-15` for the IDL)
- circom 2.2.3 (circuit compile only), CRE CLI v1.37.0 with `cre login` (simulations only)
- Ollama with `qwen3:8b` (optional, local rewriter)

Install once:

```bash
cd workflows && bun install && cd ..
cd gateway   && bun install && cd ..
cd circuits  && npm ci --ignore-scripts && cd ..
cd frontend  && npm ci && cd ..
cd programs  && npm ci && cd ..
cd scripts   && npm i && cd ..
```

Copy each `.env.example` to `.env` in `workflows/`, `gateway/`, `scripts/` and `frontend/` and fill it in locally. Never commit `.env` or keypairs.

## 1. Unit tests (no network, no keys)

| Package | Command | Expected |
|---|---|---|
| Workflows | `cd workflows && bun test && bun run typecheck` | 5 pass, no type errors |
| Gateway | `cd gateway && bun test && bun run typecheck` | 35 pass, no type errors |
| Frontend | `cd frontend && npx tsc -b && npm test` | no type errors, 10 pass |
| Circuits | `cd circuits && npm run compile && npm test` | 5 pass (the witness test needs `npm run compile` first) |
| Rust verifier check | `cd circuits && NO_DNA=1 cargo run --locked --manifest-path rust-check/Cargo.toml` | proofs verify; tampered inputs rejected |

## 2. Solana program (local validator)

```bash
cd programs
NO_DNA=1 anchor build --no-idl
cd programs/fluxo_pool && RUSTUP_TOOLCHAIN=nightly-2025-04-15 NO_DNA=1 \
  anchor idl build -o ../../target/idl/fluxo_pool.json -t ../../target/types/fluxo_pool.ts && cd ../..
NO_DNA=1 anchor test --skip-build
```

Expected: 17 passing, including on-chain Groth16 verification and the forwarder CPI.

## 3. Workflow build

```bash
cd workflows
bun run scripts/gen-enclave-key.ts        # once; refuses if SECRET_ENCLAVE_BOX_SK is already set
bun run scripts/apply-devnet-config.ts    # configs from deploy/devnet.json
./scripts/build-wasm.sh                   # rerun after any workflow change
```

## 4. CRE simulations against devnet

Run from `workflows/`. Each credit index `--i` (0–199) of a note can be spent once; reusing one fails with `NullifierUsed`.

Terminal A, to receive the sealed answer on :8787 (stop it before starting the gateway):

```bash
bun run scripts/mock-mailbox.ts
```

Terminal B:

```bash
# Build a real request from on-chain state (tree, sealed envelope, binding, proof)
node --env-file=.env --import tsx scripts/make-request.ts --i <unused index> --relayer <relayer pubkey>

# Phase 1: stage_spend (Groth16 verified on-chain)
cd .. && RELAYER_KEYPAIR=<path> node --env-file-if-exists=workflows/.env gateway/scripts/stage-spend.mjs \
  workflows/fixtures/requests/<id>/stage.json deploy/devnet.json && cd workflows

# Phase 2: TEE answer + spend finalize in one workflow
cre workflow simulate ./fluxo-request --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/request.json --broadcast --wasm "$PWD/build/fluxo-request.wasm"
```

Expected: the result has `"status":"delivered"` and a `spendTx`.

### Reused credit (negative test)

Re-run the same `stage-spend.mjs` command with the same `stage.json`. Expected: `{"staged":false,"error":"NullifierUsed"}`.

### Settle

```bash
cre workflow simulate ./fluxo-settle --target simulation-settings --non-interactive --trigger-index 0 \
  --broadcast --wasm "$PWD/build/fluxo-settle.wasm"
```

Expected: `txStatus: SUCCESS`; the operator is paid for spends finalized since the last settle (0 if none).

## 5. End-to-end in the browser

```bash
OLLAMA_ORIGINS="*" ollama serve                         # optional
cd gateway && bun run start                             # public :8788, mailbox :8787
curl -s http://127.0.0.1:8788/api/config | jq .ready    # expect {"spend":true,"faucet":true}
cd workflows && ./scripts/settle-loop.sh                # INTERVAL=60 for faster settles
cd frontend && npm run dev                              # http://127.0.0.1:5173/#app
```

In the browser with a devnet wallet (e.g. Phantom):

1. Connect wallet → **Get free test tokens** (20 tUSDC + 0.02 SOL).
2. **Deposit 10 tUSDC** → 200 credits appear.
3. Type a question → review the privacy diff → **Ask**.
4. The decrypted answer appears with a link to its spend transaction.

Browser test suite (needs Playwright Chromium):

```bash
cd frontend && npm run test:browser
```
