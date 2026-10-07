# Fluxo

## Introduction

> **Private questions deserve private answers. Today, every AI request tells someone who you are.**

Fluxo lets people use frontier AI models privately.

A normal AI request exposes you in three places: the text you write, the payment that funds it, and the infrastructure that carries it to the model. Fluxo protects each one:

- **On-device scrubbing**: your question is scrubbed on your device and raw personal data stays in the browser.
- **Zero-knowledge credits**: you pay with zero-knowledge credits on Solana.
- **Confidential inference**: the model is called from inside a Chainlink CRE Workflow.

The Solana program enforces every money rule: who can spend, how often, and when the operator gets paid.

## Key Features

- **Two-Layer Scrubber**: A local model (Ollama, `qwen3:8b`) rewrites the question in a neutral voice and splits it into generic parts. Deterministic rules then generalise structured fields and block the request if a known personal value survives.
- **Privacy Diff**: The user sees exactly what they typed next to exactly what will be sent, before anything leaves the device.
- **Local Re-Personalisation**: The model returns a branched answer, and the browser fills in the user's real values locally.
- **Anonymous ZK Credits**: One 10 tUSDC deposit buys 200 credits. Each question spends one credit with a Groth16 proof of owning *some* unspent deposit, never a specific one.
- **On-Chain Proof Verification**: The Solana program verifies every Groth16 proof itself, so no relayer or forwarder can create a spend.
- **Double-Spend Protection**: Every credit carries a one-time nullifier. A reused credit is rejected with `NullifierUsed`.
- **Confidential Inference**: The decrypted question, the model's answer and the API key exist only inside the CRE enclave. Only the sealed answer crosses back out.
- **Pay-on-Delivery**: The answer is released only after the spend is finalized on Solana, and the operator is paid only for finalized spends.

## How It Works

### 1. On-Device Scrubbing

- Runs entirely in the browser, with Ollama on the user's machine.
- Layer 1: the local model rewrites the question and removes the user's writing style.
- Layer 2: rules generalise structured details (into bands) and act as a leak check on known profile values.
- Without Ollama, the app runs Layer 2 only.

### 2. Zero-Knowledge Credits

- **Deposit**: 10 tUSDC goes into the pool vault, and a secret commitment is inserted into a depth-10 Poseidon Merkle tree on-chain.
- **Proof**: For each question, the browser proves with snarkjs that it knows a commitment in a recent tree root, without revealing which one.
- **Nullifier**: The proof exposes a one-time nullifier hash. The program records it, so the same credit can never be spent again.
- **Binding**: Each proof is bound to one specific request, so it can't be reused for a different question.

### 3. Confidential Inference

- The browser seals the scrubbed question to the enclave's public key (`nacl.box`).
- The `brizo-request` workflow runs with `handlerInTee`. Inside the enclave it checks the binding, opens the question, calls the model with the `MODEL_API_KEY` Vault secret, and seals the answer back to the user.
- `usingTheDons()` carries only the sealed ciphertext out of the enclave.

### 4. Settlement

- `brizo-spend` finalizes a spend on Solana through `SolanaClient.writeReport` and the CRE keystone forwarder.
- `brizo-settle` runs on a cron every 10 minutes and pays the operator 0.05 tUSDC per finalized spend.

## Architecture & User Flow

```
Browser app (frontend/)
  1  faucet ───────────────► gateway /api/faucet            (mints test tUSDC)
  2  deposit(commitment) ──► Solana brizo_pool.deposit      (user signs)
  3  scrub locally (Ollama + rules), show the privacy diff
  4  prove a credit (snarkjs), seal {question, bands} to the enclave key
  5  POST /api/ask ────────► gateway (gateway/)
                              a. verify the proof off-chain (cheap pre-check)
                              b. relayer tx: brizo_pool.stage_spend
                                   Groth16 verified ON-CHAIN, PendingSpend recorded
                              c. CRE brizo-request (handlerInTee, one simulation)
                                   ┌ in the enclave: check binding, open envelope,
                                   │ call the model (Vault secret), seal the answer
                                   ├ usingTheDons(): only the sealed answer crosses back
                                   ├ SolanaClient.writeReport(Spend{nullifier, binding})
                                   │   → keystone forwarder → brizo_pool.on_report:
                                   │     binding must match the staged spend, nullifier
                                   │     burned (reuse rejected), spend counted
                                   └ only if the spend landed: POST the sealed answer
                                     to the gateway mailbox
  6  GET /api/answer/:id ──► sealed answer → decrypted in the browser, branches filled

CRE brizo-settle (cron) ─► writeReport(Settle) ─► vault pays the operator for finalized spends only
```

### Who Sees What

| Observer | Sees | Does not see |
|---|---|---|
| Model provider (via OpenRouter) | A generic, scrubbed question from the enclave's API account | The user's identity, raw data, wallet or IP |
| Gateway | IP address, ciphertext, the ZK proof, timing | The plaintext question or answer, which deposit paid |
| CRE node operators | Workflow code, triggers, chain writes, nullifier and binding, the sealed answer | The decrypted question, the model answer, the API key |
| Fluxo team | Same as the gateway. We generated the enclave box key and hold it as a CRE secret, so we could decrypt an intercepted scrubbed question | Raw data, which never leaves the user's device |
| Anyone reading Solana | Deposits (wallet and amount), nullifiers, settlement amounts | Which deposit paid for which question |

## Solana Program

`programs/brizo_pool` (Anchor 0.31) holds the funds and enforces every rule.

| Instruction | What it does |
|---|---|
| `deposit` | Takes exactly 10 tUSDC and inserts the commitment into the Poseidon tree (`sol_poseidon` syscall, 32-root history) |
| `stage_spend` | Verifies the Groth16 proof on-chain (`groth16-solana`, compressed points, ~120k CU) against a recent root and an unspent nullifier, then records a `PendingSpend` PDA |
| `on_report` | Callable only through the CRE keystone forwarder (`verify_forwarder_cpi`). Handles `Spend` and `Settle` reports |

- **`Spend { nullifier_hash, request_binding }`** (65 bytes): the binding must match the staged spend. Burns the nullifier, counts the spend and refunds the relayer's rent.
- **`Settle { epoch }`**: pays the operator `(spends − claimed) × 0.05 tUSDC` from the vault.

## CRE Workflows

`workflows/` is TypeScript on `@chainlink/cre-sdk` 1.23.0.

| Workflow | Trigger | Role |
|---|---|---|
| `brizo-request` | HTTP, `handlerInTee` | Main path: confidential answer, Solana spend finalize, then answer delivery |
| `brizo-spend` | HTTP | Spend finalize only (two-step path) |
| `brizo-infer` | HTTP, `handlerInTee` | Confidential answer only (two-step path) |
| `brizo-settle` | Cron `0 */10 * * * *` | Settle report and operator payout |

The Spend report is designed to fit CRE's **default** Solana limits (265-byte signed report, 300k CU). That is why the proof is verified in `stage_spend`, and the CRE report only finalizes.

## Contract Addresses (Solana Devnet)

- **Program `brizo_pool`**: [`HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC`](https://explorer.solana.com/address/HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC?cluster=devnet)
- **Pool PDA** (CRE simulator forwarder): `E4VujnAbw8qugcpogcSCaXVHC2r8qoAzeoAoDrnomNPT`
- **tUSDC Mint** (test token, 6 decimals): `7NfRf2AgUw3yRMSuj9EXsEJNC5nSr8RmqtrXKxv6hVFJ`
- **Tree PDA / Leaves / NullifierSet**: `J4uUU49D…` / `EfSCPTpc…` / `EMqup2tD…`
- **Vault / Operator token accounts**: `62hvjRCm…` / `Edk22EeX…`

Full addresses are in [`deploy/devnet.json`](deploy/devnet.json). The IDL is in [`deploy/idl/brizo_pool.json`](deploy/idl/brizo_pool.json).

### Example Transactions

| Type | Transaction |
|---|---|
| Program deploy | [`3WfQPHLX…`](https://explorer.solana.com/tx/3WfQPHLXX38eyV3qcubzJeSTUgNtRQ51Frag1LcnDzh4pqpBNEMGYJnTxnaymizCaU6FtBEXihyAi5rdGJip9fEf?cluster=devnet) |
| Pool initialise | [`5vHcT85R…`](https://explorer.solana.com/tx/5vHcT85RhE1cg1ZbdRvii2Kge3UVJEqD8Tb57bK74MzEnQxF1Q9M9o83fqxoJ1uyv37A4Z6XeZV1zy56XXanx78D?cluster=devnet) |
| Deposit | [`2W72FdqW…`](https://explorer.solana.com/tx/2W72FdqWyjvh6edud6HHDgV9N3xz2pb7sBCHdAhPX3BdmjByfqQKL682QfDQTrwPqC1duXbsEi3PpTDRuWWZtFay?cluster=devnet) |
| Stage spend (Groth16 verified on-chain) | [`33dQtAxL…`](https://explorer.solana.com/tx/33dQtAxLJRKtMv6MACydfKTUvMfTKePeZdn2gjWmJ7HkUe2tLUUexCWfuTxZKJuzVeLQ2C3HPDBwtvzKAdWujjCy?cluster=devnet) |
| Spend finalized by CRE (`brizo-spend`) | [`34LDToSM…`](https://explorer.solana.com/tx/34LDToSMPhcYfboPdaetufAcPteHGR3AHigPCHUgJZRFpxrAa2991D31X1p28JksgaPu8f1z19jyqpksCBCsmDR6?cluster=devnet) |
| Full question through the gateway (`brizo-request`) | [`5tUUkGvm…`](https://explorer.solana.com/tx/5tUUkGvmce4YJYNedvZx5Qv2yhQWcxPNtcqzTkfriUu7ZYnd5EYf5QcPJpRNo6VF7Wbc3nz9pu6XsFDa7tB3e9ux?cluster=devnet) |
| Reused credit | Rejected with `NullifierUsed` at stage and finalize (see [`docs/EVIDENCE.md`](docs/EVIDENCE.md)) |
| Settle (operator paid) | [`56y25StB…`](https://explorer.solana.com/tx/56y25StBajhcbQRA2MxoGFY6Ayg2rzJLCg9kcpmg9Ga9FaGT1Bbspatzh7bkvgfdr64oLbLHEyTk5Usm42HqwxPR?cluster=devnet), [`3BP1wnes…`](https://explorer.solana.com/tx/3BP1wnesu38p2JRuYhqidTDHaNTBAar4fjBh297E2jznjfcVnxMKLPMhycdpT6z5mdZCmiWPbo1NfLTHkVemcNKa?cluster=devnet) |

Every simulation command, its output and each signature are logged in [`docs/EVIDENCE.md`](docs/EVIDENCE.md).

## Quick Start

### Prerequisites

- CRE CLI v1.37.0 (`cre login`)
- Bun 1.2.21 or newer (older versions fail every TS workflow with `wasm unreachable`)
- Node 23
- Solana CLI 2.3.0
- Anchor 0.31.0, plus `nightly-2025-04-15` for the IDL
- circom 2.2.3 and snarkjs 0.7.6 (circuits only)
- Ollama with `qwen3:8b` (local scrubber)

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
cre workflow simulate ./brizo-request --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/request.json --broadcast --wasm "$PWD/build/brizo-request.wasm"

# Two-step path: spend finalize, then confidential answer
cre workflow simulate ./brizo-spend --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/spend.json --broadcast --wasm "$PWD/build/brizo-spend.wasm"
cre workflow simulate ./brizo-infer --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/infer.json --wasm "$PWD/build/brizo-infer.wasm"

# Settle: pay the operator for finalized spends
cre workflow simulate ./brizo-settle --target simulation-settings --non-interactive --trigger-index 0 \
  --broadcast --wasm "$PWD/build/brizo-settle.wasm"

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
cd programs/brizo_pool && RUSTUP_TOOLCHAIN=nightly-2025-04-15 NO_DNA=1 \
  anchor idl build -o ../../target/idl/brizo_pool.json -t ../../target/types/brizo_pool.ts && cd ../..

# 17 localnet tests, including on-chain Groth16 and the forwarder CPI
NO_DNA=1 anchor test --skip-build

# Deploy and initialise (mint, vault, large accounts, pool → deploy/devnet.json)
NO_DNA=1 anchor deploy --provider.cluster devnet -p brizo_pool
cd ../scripts && node --env-file=.env --import tsx init-devnet.ts
```

More detail in [`gateway/README.md`](gateway/README.md), [`frontend/README.md`](frontend/README.md) and [`circuits/README.md`](circuits/README.md).

## Honest Limits

- **CRE runs in the simulator.** Deployment access wasn't available during the hackathon. Solana writes go through the simulator's mock forwarder, but the transactions are real devnet transactions. The reports fit CRE's default production limits, so deployment needs no protocol change.
- **The enclave key is ours.** We generated it and hold it as a CRE secret, so we could decrypt an intercepted scrubbed question.
- **The anonymity set is everyone who deposited.** With few users, payment privacy is weak.
- **Scrubbing is best effort.** The local model can miss details, and the rules only guarantee that known profile values don't leave the device. In rules-only mode, the user's writing style still leaves the device.
- **The gateway sees the user's IP.** Use Tor Browser for network privacy; the demo doesn't enforce it.
- **10-second model budget** (CRE's HTTP action timeout), so answers are capped at 600 tokens. A timeout returns a sealed "model unavailable" notice.
- **Trusted setup** uses the public Hermez Powers of Tau plus a single local phase-2 contribution, not a public ceremony.
- **Unaudited** circuit, program and workflows. The program's upgrade authority is the deployer key.
- **Capacity**: 1,024 deposits, 4,096 nullifiers, 32-root history.
- **tUSDC is our own devnet test token**, not a real stablecoin.

## Roadmap

- Deploy the workflows to a CRE DON with the real Solana forwarder, and `brizo-request` as a deployed Confidential Workflow.
- Attested in-enclave key generation, so nobody (including us) holds the box key.
- Redeem unused credits to a fresh address.
- Privacy receipts: a salted per-epoch receipts root in `Settle`.
- A public multi-party trusted setup ceremony, and an audit.
- Deeper trees, multiple trees and compressed nullifier accounts.
- Upgrade authority moved to a multisig, or frozen.
- An agent SDK with spending caps, x402 top-ups, and the gateway as a Tor onion service.

## Built With

All code was written during TOKEN2049 Origins on 7 Oct 2026.

**Templates**
- Chainlink `cre-templates/building-blocks/solana-read-write/solana-read-write-ts`: forwarder CPI check, report encoding, simulator forwarder values
- `cre init -t hello-confidential-workflows-ts`: the `handlerInTee` structure

**Libraries**
- CRE and Solana: `@chainlink/cre-sdk`, `@solana/web3.js`, `@solana/codecs`, `zod`, `tweetnacl`, `@noble/hashes`, Anchor, `groth16-solana`, `solana-poseidon`
- ZK: circom, circomlib, snarkjs, circomlibjs
- Gateway and app: Hono, Vite, React

**Models**
- `anthropic/claude-haiku-4.5` via OpenRouter, called from the enclave
- Ollama `qwen3:8b` on the user's device

## Development Team

- [@0xr10t](https://github.com/0xr10t)
- [@akronim26](https://github.com/akronim26)
