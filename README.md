# Brizo

> **Ask an AI about the things you'd never put your name on.**

Every time you ask an AI model something, you give yourself away three ways. There's what you type, there's the card or wallet that paid for it, and there's whoever can read the request on its way to the model. Health worries, money trouble, a legal mess: these are exactly the questions people most want answered and least want tied back to them.

Brizo is our attempt to close all three gaps at once.

- **Your words** get scrubbed on your own device before anything is sent. Your raw personal data never leaves the browser, and your real details are filled back into the answer locally.
- **Your payment** is a zero-knowledge credit on Solana. You deposit once, then each question spends a credit that can't be linked back to your deposit.
- **The request** is sealed to a Chainlink CRE Confidential Workflow. The model is called from inside a secure enclave with an API key nobody else can see, and the answer comes back sealed to you.

We built it in one day at TOKEN2049 Origins (7 Oct 2026) for Chainlink's **Best workflow with CRE** and Solana's **Best Use of Solana** tracks.

## Key Features

- **Scrubbing on your device**: a local model (Ollama, `qwen3:8b`) rewrites your question in a neutral voice and splits it into generic parts. A second, rule-based pass generalises structured details into broader bands, and refuses to send at all if a personal value you saved still slips through.
- **A privacy diff you can read**: before anything goes out, you see exactly what you typed next to exactly what will be sent.
- **Credits nobody can trace**: deposit 10 tUSDC, get 200 credits. Each question comes with a Groth16 proof that you own *some* unspent deposit, plus a one-time nullifier so the same credit can't be spent twice.
- **Proofs checked on-chain**: the Solana program verifies every proof itself. Nobody, including us, can mint credits out of thin air; only real deposits go into the tree.
- **The model call happens in an enclave**: the decrypted question, the model's answer and the API key only ever exist inside the CRE Confidential Workflow.
- **Pay only for what got delivered**: the answer is released only after the spend lands on Solana, and the operator is paid only for spends that were actually finalized.

## How it works

1. **Get test tokens.** The app hits our faucet and you receive tUSDC on devnet.
2. **Deposit.** You sign one transaction that puts 10 tUSDC in the pool. A secret commitment goes into a Poseidon Merkle tree on-chain. This is the only step where your wallet shows up.
3. **Ask.** Your question is scrubbed locally and you check the privacy diff.
4. **Prove and seal.** The browser builds a zero-knowledge proof for one credit and seals the scrubbed question to the enclave's public key.
5. **Stage the spend.** The gateway does a cheap off-chain check of the proof, then a relayer submits `stage_spend`. The Solana program verifies the proof on-chain and records a pending spend.
6. **Answer inside the enclave.** The `brizo-request` workflow runs in CRE. Inside the enclave it opens your sealed question, calls the model and seals the answer. Only the sealed answer crosses back out.
7. **Finalize on Solana.** The workflow writes a small report through the CRE forwarder. The program checks it matches the staged spend, burns the nullifier (a reused credit is rejected with `NullifierUsed`) and counts the spend.
8. **Read the answer.** Only if the spend landed does the sealed answer reach the gateway's mailbox. Your browser picks it up, decrypts it and fills your real details back in.

Every ten minutes `brizo-settle` sends a settle report, and the vault pays the operator for the spends that were finalized.

## Who sees what

| Who | What they can see | What they can't |
|---|---|---|
| The model provider (via OpenRouter) | A generic, scrubbed question from the enclave's account | You, your raw data, your wallet, your IP |
| Our gateway | Your IP, ciphertext, the proof, timing | Your question or answer in plain text, which deposit paid |
| CRE node operators | Workflow code, chain writes, the nullifier, the *sealed* answer | The decrypted question, the answer, the API key |
| Us, the team | The same as the gateway. We also generated the enclave's key, so we *could* decrypt a scrubbed question if we intercepted it | Your raw data, which never leaves your device |
| Anyone watching Solana | Deposits (wallet and amount), nullifiers, payouts | Which deposit paid for which question |

## Solana and CRE, side by side

**Solana holds the money and enforces the rules.** The `brizo_pool` program (Anchor 0.31) has three jobs:

- `deposit` takes exactly 10 tUSDC and adds your commitment to a depth-10 Poseidon tree, using the `sol_poseidon` syscall and keeping the last 32 roots.
- `stage_spend` verifies the Groth16 proof on-chain with `groth16-solana` (compressed points, around 120k compute units) against a recent root and an unused nullifier, then records a `PendingSpend`.
- `on_report` can only be called through the CRE keystone forwarder. A `Spend` report (65 bytes) must match the staged spend; it burns the nullifier and counts the spend. A `Settle` report pays the operator 0.05 tUSDC for every spend not yet paid out.

Because the proof is checked on-chain, even a misbehaving forwarder can't invent a spend.

**CRE handles the confidential part and ties everything together.** The workflows are TypeScript on `@chainlink/cre-sdk` 1.23.0:

| Workflow | Trigger | What it does |
|---|---|---|
| `brizo-request` | HTTP, in the enclave (`handlerInTee`) | The main path: opens the question, calls the model with the `MODEL_API_KEY` secret, seals the answer, finalizes the spend with `SolanaClient.writeReport`, and only then delivers the answer |
| `brizo-spend` | HTTP | Finalizes a spend on its own (two-step path) |
| `brizo-infer` | HTTP, in the enclave | Produces the sealed answer on its own (two-step path) |
| `brizo-settle` | Cron, every 10 minutes | Pays the operator for finalized spends |

We split it this way on purpose. CRE's default Solana limits are a 265-byte report and 300k compute units, so the heavy proof check lives in `stage_spend` and the CRE report just finalizes.

## Deployed on Solana devnet

- **Program `brizo_pool`**: [`HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC`](https://explorer.solana.com/address/HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC?cluster=devnet)
- **Pool PDA** (CRE simulator forwarder): `E4VujnAbw8qugcpogcSCaXVHC2r8qoAzeoAoDrnomNPT`
- **tUSDC mint** (our own test token, 6 decimals): `7NfRf2AgUw3yRMSuj9EXsEJNC5nSr8RmqtrXKxv6hVFJ`

The rest of the accounts are in [`deploy/devnet.json`](deploy/devnet.json), and the IDL is in [`deploy/idl/brizo_pool.json`](deploy/idl/brizo_pool.json).

### Transactions you can click

- Program deploy: [`3WfQPHLX…`](https://explorer.solana.com/tx/3WfQPHLXX38eyV3qcubzJeSTUgNtRQ51Frag1LcnDzh4pqpBNEMGYJnTxnaymizCaU6FtBEXihyAi5rdGJip9fEf?cluster=devnet)
- Pool initialise: [`5vHcT85R…`](https://explorer.solana.com/tx/5vHcT85RhE1cg1ZbdRvii2Kge3UVJEqD8Tb57bK74MzEnQxF1Q9M9o83fqxoJ1uyv37A4Z6XeZV1zy56XXanx78D?cluster=devnet)
- Deposit: [`2W72FdqW…`](https://explorer.solana.com/tx/2W72FdqWyjvh6edud6HHDgV9N3xz2pb7sBCHdAhPX3BdmjByfqQKL682QfDQTrwPqC1duXbsEi3PpTDRuWWZtFay?cluster=devnet)
- Stage spend, proof verified on-chain: [`33dQtAxL…`](https://explorer.solana.com/tx/33dQtAxLJRKtMv6MACydfKTUvMfTKePeZdn2gjWmJ7HkUe2tLUUexCWfuTxZKJuzVeLQ2C3HPDBwtvzKAdWujjCy?cluster=devnet)
- Spend finalized by CRE (`brizo-spend`): [`34LDToSM…`](https://explorer.solana.com/tx/34LDToSMPhcYfboPdaetufAcPteHGR3AHigPCHUgJZRFpxrAa2991D31X1p28JksgaPu8f1z19jyqpksCBCsmDR6?cluster=devnet)
- A full question through the gateway (`brizo-request`, enclave answer plus spend): [`5tUUkGvm…`](https://explorer.solana.com/tx/5tUUkGvmce4YJYNedvZx5Qv2yhQWcxPNtcqzTkfriUu7ZYnd5EYf5QcPJpRNo6VF7Wbc3nz9pu6XsFDa7tB3e9ux?cluster=devnet)
- Reused credit: rejected with `NullifierUsed` at both stage and finalize (output in [`docs/EVIDENCE.md`](docs/EVIDENCE.md))
- Settle, operator paid: [`56y25StB…`](https://explorer.solana.com/tx/56y25StBajhcbQRA2MxoGFY6Ayg2rzJLCg9kcpmg9Ga9FaGT1Bbspatzh7bkvgfdr64oLbLHEyTk5Usm42HqwxPR?cluster=devnet), [`3BP1wnes…`](https://explorer.solana.com/tx/3BP1wnesu38p2JRuYhqidTDHaNTBAar4fjBh297E2jznjfcVnxMKLPMhycdpT6z5mdZCmiWPbo1NfLTHkVemcNKa?cluster=devnet)

Every simulation we ran, with its output and signature, is logged in [`docs/EVIDENCE.md`](docs/EVIDENCE.md).

## Quick Start

### What you'll need

- CRE CLI v1.37.0 (run `cre login` first)
- Bun 1.2.21 or newer. Older versions make every TypeScript workflow fail with `wasm unreachable`.
- Node 23
- Solana CLI 2.3.0
- Anchor 0.31.0, plus the `nightly-2025-04-15` toolchain for building the IDL
- circom 2.2.3 and snarkjs 0.7.6, only if you want to rebuild the circuit
- Ollama with `qwen3:8b`, for the local scrubber

### Secrets

Nothing secret is committed. Each folder has a `.env.example`; copy it to `.env` and fill it in.

- `workflows/.env` needs a funded devnet keypair path (`CRE_SOLANA_PRIVATE_KEY`), the placeholder `CRE_ETH_PRIVATE_KEY` from the example, your OpenRouter key (`SECRET_MODEL_API_KEY`), the enclave key (`SECRET_ENCLAVE_BOX_SK`, written by `bun run scripts/gen-enclave-key.ts`) and a private devnet RPC (`SOLANA_DEVNET_RPC_URL`). The public devnet RPC rate-limits you almost immediately.
- `gateway/.env` needs keypair paths for the faucet and the relayer.
- `scripts/.env` needs the admin and faucet keypair paths used for deployment.

### Install

```bash
git clone https://github.com/akronim26/fluxo.git
cd fluxo

cd workflows && bun install && ./scripts/build-wasm.sh   # builds all four workflows
cd ../gateway && bun install
cd ../frontend && npm install
cd ../circuits && npm ci --ignore-scripts
```

### Run the app

```bash
cd gateway && bun run src/server.ts      # public API on :8788, private mailbox on :8787
cd frontend && npm run dev               # open http://127.0.0.1:5173
```

### Run the CRE workflows (from `workflows/`)

```bash
# one paid question: enclave answer + spend finalized on Solana (after stage_spend)
cre workflow simulate ./brizo-request --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/request.json --broadcast --wasm "$PWD/build/brizo-request.wasm"

# the two-step path: finalize the spend, then get the answer
cre workflow simulate ./brizo-spend --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/spend.json --broadcast --wasm "$PWD/build/brizo-spend.wasm"
cre workflow simulate ./brizo-infer --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/infer.json --wasm "$PWD/build/brizo-infer.wasm"

# pay the operator for finalized spends
cre workflow simulate ./brizo-settle --target simulation-settings --non-interactive --trigger-index 0 \
  --broadcast --wasm "$PWD/build/brizo-settle.wasm"

# keep settling every 10 minutes, standing in for the DON's scheduler
./scripts/settle-loop.sh
```

Want a real request built from on-chain state, the same way the browser builds one? Run this from `workflows/`:

```bash
npx tsx scripts/make-request.ts --i <credit index> --relayer <relayer pubkey>
```

It writes `stage.json`, `spend.json`, `infer.json` and `ask.json` into `fixtures/requests/<id>/`. Stage it with:

```bash
cd ../scripts && node --env-file=.env --import tsx stage-spend.ts ../workflows/fixtures/requests/<id>/stage.json
```

### Build and test the Solana program (from `programs/`)

```bash
NO_DNA=1 anchor build --no-idl
cd programs/brizo_pool && RUSTUP_TOOLCHAIN=nightly-2025-04-15 NO_DNA=1 \
  anchor idl build -o ../../target/idl/brizo_pool.json -t ../../target/types/brizo_pool.ts && cd ../..
NO_DNA=1 anchor test --skip-build          # 17 localnet tests, including on-chain Groth16 and the forwarder CPI
NO_DNA=1 anchor deploy --provider.cluster devnet -p brizo_pool
cd ../scripts && node --env-file=.env --import tsx init-devnet.ts   # mint, vault, accounts, pool → deploy/devnet.json
```

There's more detail in [`gateway/README.md`](gateway/README.md), [`frontend/README.md`](frontend/README.md) and [`circuits/README.md`](circuits/README.md).

## What it doesn't do (yet)

We'd rather you hear the weak spots from us.

- **CRE runs in the simulator.** We didn't have deployment access during the hackathon, so every workflow runs through `cre workflow simulate` and writes to Solana via the simulator's forwarder. The Solana transactions themselves are real devnet transactions, and the reports fit CRE's default production limits, so deploying shouldn't need a protocol change.
- **We hold the enclave key.** We generated it and stored it as a CRE secret, so in principle we could decrypt a scrubbed question we intercepted. Generating the key inside the enclave, with attestation, is next on the list.
- **Privacy grows with the crowd.** Your payment hides among everyone who deposited. With only a handful of users, that's not much cover.
- **Scrubbing is best effort.** The local model can miss things. The rules only guarantee that the personal values you saved don't leave your device. Without Ollama the app runs rules only, and your writing style does leave the device.
- **The gateway sees your IP.** Use Tor Browser if that matters to you; the demo doesn't force it.
- **Answers are short.** CRE gives the model call 10 seconds, so we cap answers at 600 tokens. If the model times out you get a sealed "model unavailable" note instead.
- **The trusted setup is minimal**: the public Hermez Powers of Tau plus one local phase-2 contribution, not a public ceremony.
- **Nothing is audited**: not the circuit, the program or the workflows. The program's upgrade authority is still the deployer key.
- **The pool is small**: 1,024 deposits, 4,096 nullifiers, 32 remembered roots.
- **tUSDC is our own devnet token**, not a real stablecoin.

## Where we'd take it next

- Deploy the workflows to a real CRE DON with the real Solana forwarder, and run `brizo-request` as a deployed Confidential Workflow.
- Generate the enclave key inside the enclave, so nobody (us included) ever holds it.
- Let people redeem unused credits to a fresh address.
- Privacy receipts in each settle report.
- A proper multi-party trusted setup, and an audit.
- Bigger and multiple trees, compressed nullifier accounts.
- Hand the upgrade authority to a multisig, or freeze it.
- An agent SDK with spending caps, x402 top-ups, and the gateway as a Tor onion service.

## Built at TOKEN2049 Origins

All of the code was written during the hackathon on 7 Oct 2026.

We started from two Chainlink templates: `cre-templates/building-blocks/solana-read-write/solana-read-write-ts` (forwarder CPI check, report encoding, simulator forwarder values) and `cre init -t hello-confidential-workflows-ts` (the `handlerInTee` structure).

Libraries we leaned on:

- **CRE and Solana**: `@chainlink/cre-sdk`, `@solana/web3.js`, `@solana/codecs`, `zod`, `tweetnacl`, `@noble/hashes`, Anchor, `groth16-solana`, `solana-poseidon`
- **Zero knowledge**: circom, circomlib, snarkjs, circomlibjs
- **Gateway and app**: Hono, Vite and React

The model is `anthropic/claude-haiku-4.5` through OpenRouter, called from the enclave. The scrubber runs Ollama `qwen3:8b` on your own machine.

### Team

- [@0xr10t](https://github.com/0xr10t)
- [@akronim26](https://github.com/akronim26)
