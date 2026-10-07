![Fluxo logo](public/logo.png)

## Introduction

> **Private questions deserve private answers. Today, every AI request tells someone who you are.**

Fluxo lets people use frontier AI models privately.

A normal AI request exposes you in three places: the text you write, the payment that funds it, and the infrastructure that carries it to the model. Fluxo protects each one:

- **On-device scrubbing**: your question is scrubbed on your device and raw personal data stays in the browser.
- **Zero-knowledge credits**: you pay with zero-knowledge credits on Solana.
- **Confidential inference**: the model is called from inside a Chainlink CRE Workflow.

## Key Features

- **Two-Layer Scrubber**: A local model rewrites the question in a neutral voice and splits it into generic parts. Deterministic rules then generalise structured fields and block the request if a known personal value survives.
- **Privacy Diff**: The user sees exactly what they typed next to exactly what will be sent, before anything leaves the device.
- **Local Re-Personalisation**: The model returns a branched answer, and the browser fills in the user's real values locally.
- **Anonymous ZK Credits**: One 10 tUSDC deposit buys 200 credits. Each question spends one credit with a Groth16 proof of owning some unspent deposit wuthout revealing the actual one.
- **On-Chain Proof Verification**: The Solana program verifies every Groth16 proof itself, so no relayer or forwarder can create a spend.
- **Double-Spend Protection**: Every credit carries a one-time nullifier so you can't reuse one.
- **Confidential Inference**: The decrypted question, the model's answer and the API key exist only inside the CRE enclave.
- **Pay-on-Delivery**: The answer is released only after the spend is finalized on Solana, and the operator is paid only for finalized spends.

## How It Works

### 1. On-Device Scrubbing

- Runs entirely in the browser, with local model on the user's machine.
- Layer 1: the local model rewrites the question and removes the user's writing style.
- Layer 2: rules generalise structured details (into bands) and act as a leak check on known profile values.

### 2. Zero-Knowledge Credits

- **Deposit**: 10 tUSDC goes into the pool vault, and a secret commitment is inserted into a depth-10 Poseidon Merkle tree on-chain.
- **Proof**: For each question, the browser proves with `snarkjs` that it knows a commitment in a recent tree root.
- **Nullifier**: The proof exposes an one-time nullifier hash. The program records it, so the same credit can never be spent again.
- **Binding**: Each proof is bound to one specific request, so it can't be reused for a different question.

### 3. Confidential Inference

- The browser seals the scrubbed question to the enclave's public key.
- The `fluxo-request` workflow runs with `handlerInTee`. Inside the enclave it checks the binding, opens the question, calls the model with the `MODEL_API_KEY` Vault secret, and seals the answer back to the user.
- `usingTheDons()` carries only the sealed ciphertext out of the enclave.

### 4. Settlement

- `fluxo-spend` finalizes a spend on Solana and the CRE keystone forwarder.
- `fluxo-settle` runs on a cron every 10 minutes and pays the operator 0.05 tUSDC per finalized spend.

## Architecture

![Fluxo architecture](public/architecture.png)

## Contract Addresses (Solana Devnet)

- **Program `fluxo_pool`**: [`HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC`](https://explorer.solana.com/address/HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC?cluster=devnet)
- **Pool PDA** (CRE simulator forwarder): `E4VujnAbw8qugcpogcSCaXVHC2r8qoAzeoAoDrnomNPT`
- **tUSDC Mint** (test token, 6 decimals): `7NfRf2AgUw3yRMSuj9EXsEJNC5nSr8RmqtrXKxv6hVFJ`
- **Tree PDA / Leaves / NullifierSet**: `J4uUU49D…` / `EfSCPTpc…` / `EMqup2tD…`
- **Vault / Operator token accounts**: `62hvjRCm…` / `Edk22EeX…`

Full addresses are in [`deploy/devnet.json`](deploy/devnet.json). The IDL is in [`deploy/idl/fluxo_pool.json`](deploy/idl/fluxo_pool.json).

## Quick Start

### Prerequisites

- CRE CLI v1.37.0 (`cre login`)
- Bun 1.2.21 or newer (older versions fail every TS workflow with `wasm unreachable`)
- Node 23
- Solana CLI 2.3.0
- Anchor 0.31.0, plus `nightly-2025-04-15` for the IDL
- circom 2.2.3 and snarkjs 0.7.6 (circuits only)
- A local model

### Installation

```bash
# Clone the repository
git clone https://github.com/akronim26/fluxo.git
cd fluxo

# Install dependencies and build the workflows
cd workflows && bun install && ./scripts/build-wasm.sh
cd ../gateway && bun install
cd ../frontend && npm install
cd ../circuits && npm ci --ignore-scripts
```

### Environment Variables

Each folder has a `.env.example`. Copy it to `.env` and fill it in. Nothing secret is committed.

**`workflows/.env`**
- `CRE_SOLANA_PRIVATE_KEY`: path to a funded devnet keypair (pays simulation broadcast fees)
- `CRE_ETH_PRIVATE_KEY`: the placeholder from `.env.example` (required by the CLI)
- `SECRET_MODEL_API_KEY`: OpenRouter key
- `SECRET_ENCLAVE_BOX_SK`: written by `bun run scripts/gen-enclave-key.ts`
- `SOLANA_DEVNET_RPC_URL`: a private devnet RPC (the public endpoint returns 429 under normal load)

**`gateway/.env`**: keypair paths for the faucet mint authority and the `stage_spend` relayer.

**`scripts/.env`**: admin and faucet keypair paths for deployment.

### Running the App

```bash
# Gateway: public API on :8788, private mailbox on :8787
cd gateway && bun run src/server.ts

# Frontend: http://127.0.0.1:5173
cd frontend && npm run dev
```

### CRE Simulations

Run from `workflows/`:

```bash
# One paid question: TEE answer + Solana spend finalize (after the relayer's stage_spend)
cre workflow simulate ./fluxo-request --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/request.json --broadcast --wasm "$PWD/build/fluxo-request.wasm"

# Two-step path: spend finalize, then confidential answer
cre workflow simulate ./fluxo-spend --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/spend.json --broadcast --wasm "$PWD/build/fluxo-spend.wasm"
cre workflow simulate ./fluxo-infer --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/infer.json --wasm "$PWD/build/fluxo-infer.wasm"

# Settle: pay the operator for finalized spends
cre workflow simulate ./fluxo-settle --target simulation-settings --non-interactive --trigger-index 0 \
  --broadcast --wasm "$PWD/build/fluxo-settle.wasm"

# Keep settling on the cron cadence (stands in for the DON scheduler)
./scripts/settle-loop.sh
```

To build a real request from on-chain state, the way the browser does:

```bash
# Writes stage.json, spend.json, infer.json and ask.json to fixtures/requests/<id>/
npx tsx scripts/make-request.ts --i <credit index> --relayer <relayer pubkey>

# Stage it
cd ../scripts && node --env-file=.env --import tsx stage-spend.ts ../workflows/fixtures/requests/<id>/stage.json
```

### Solana Program

Run from `programs/`:

```bash
NO_DNA=1 anchor build --no-idl
cd programs/fluxo_pool && RUSTUP_TOOLCHAIN=nightly-2025-04-15 NO_DNA=1 \
  anchor idl build -o ../../target/idl/fluxo_pool.json -t ../../target/types/fluxo_pool.ts && cd ../..

# 17 localnet tests, including on-chain Groth16 and the forwarder CPI
NO_DNA=1 anchor test --skip-build

# Deploy and initialise (mint, vault, large accounts, pool → deploy/devnet.json)
NO_DNA=1 anchor deploy --provider.cluster devnet -p fluxo_pool
cd ../scripts && node --env-file=.env --import tsx init-devnet.ts
```

## Development Team

- [Soham](https://github.com/0xr10t)
- [Abhivansh](https://github.com/akronim26)
