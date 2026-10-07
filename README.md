# Brizo

> Ask an AI about the things you'd never put your name on.

Asking an AI model something gives you away in three ways:

- what you type
- how you pay for it
- who can read the request on its way to the model

Brizo closes all three:

- Your question is scrubbed on your device. Your raw personal data stays in the browser.
- You pay with zero-knowledge credits on Solana. A credit can't be traced back to your deposit.
- The model is called from inside a Chainlink CRE Confidential Workflow. Only the enclave sees the question and the API key.

We built it at TOKEN2049 Origins (7 Oct 2026) for two tracks: Chainlink's "Best workflow with CRE" and Solana's "Best Use of Solana".

## Features

- A local model (Ollama, `qwen3:8b`) rewrites your question in a neutral voice and splits it into generic parts.
- A rule-based pass then turns structured details into broader bands.
- If a personal value you saved is still in the text, the app won't send it.
- You see a privacy diff: what you typed next to what will be sent.
- The answer comes back sealed, and your real details are filled back in locally.
- One deposit of 10 tUSDC gets you 200 credits.
- Each question spends one credit with a Groth16 proof that you own some unspent deposit.
- A one-time nullifier stops the same credit from being spent twice.
- The Solana program verifies every proof on-chain.
- Only real deposits go into the tree, so nobody (including us) can create credits.
- The answer is released only after the spend lands on Solana.
- The operator only gets paid for spends that were finalized.

## How it works

1. The app gets you test tUSDC from our faucet.
2. You deposit 10 tUSDC. A secret commitment goes into a Poseidon Merkle tree on-chain.
3. You type a question. It's scrubbed locally and you check the privacy diff.
4. The browser builds a ZK proof for one credit.
5. The browser seals the scrubbed question to the enclave's public key.
6. The gateway checks the proof off-chain first, as a cheap filter.
7. A relayer sends `stage_spend`. The Solana program verifies the proof and records a pending spend.
8. The `brizo-request` workflow runs. Inside the enclave it opens the question, calls the model and seals the answer.
9. Only the sealed answer leaves the enclave.
10. The workflow writes a report through the CRE forwarder.
11. The program checks the report against the staged spend and burns the nullifier.
12. A reused credit fails here with `NullifierUsed`.
13. Once the spend lands, the sealed answer goes to the gateway mailbox.
14. Your browser fetches it, decrypts it and fills your details back in.

Separately, `brizo-settle` runs every 10 minutes and pays the operator for finalized spends.

## Who sees what

| Who | Sees | Doesn't see |
|---|---|---|
| Model provider (via OpenRouter) | A generic, scrubbed question from the enclave's account | You, your raw data, your wallet, your IP |
| Our gateway | Your IP, ciphertext, the proof, timing | The question or answer in plain text, which deposit paid |
| CRE node operators | Workflow code, chain writes, the nullifier, the sealed answer | The decrypted question, the answer, the API key |
| Us | Same as the gateway. We also made the enclave key, so we could decrypt a scrubbed question we intercepted | Your raw data, which never leaves your device |
| Anyone on Solana | Deposits (wallet and amount), nullifiers, payouts | Which deposit paid for which question |

## Solana side

The `brizo_pool` program (Anchor 0.31) holds the money and enforces the rules.

`deposit`
- Takes exactly 10 tUSDC.
- Adds your commitment to a depth-10 Poseidon tree (`sol_poseidon` syscall).
- Keeps the last 32 roots.

`stage_spend`
- Verifies the Groth16 proof on-chain with `groth16-solana` (compressed points, about 120k CU).
- Checks the root is recent and the nullifier is unused.
- Records a `PendingSpend`.

`on_report`
- Can only be called through the CRE keystone forwarder.
- `Spend` (65 bytes): must match the staged spend, then burns the nullifier and counts the spend.
- `Settle`: pays the operator 0.05 tUSDC per spend not yet paid out.

Since the proof is checked on-chain, a misbehaving forwarder still can't create a spend.

## CRE side

The workflows are TypeScript on `@chainlink/cre-sdk` 1.23.0.

| Workflow | Trigger | Job |
|---|---|---|
| `brizo-request` | HTTP, in the enclave (`handlerInTee`) | Main path. Opens the question, calls the model with the `MODEL_API_KEY` secret, seals the answer, finalizes the spend with `SolanaClient.writeReport`, then delivers the answer |
| `brizo-spend` | HTTP | Finalizes a spend on its own (two-step path) |
| `brizo-infer` | HTTP, in the enclave | Makes the sealed answer on its own (two-step path) |
| `brizo-settle` | Cron, every 10 minutes | Pays the operator for finalized spends |

- CRE's default Solana limits are a 265-byte report and 300k CU.
- So the heavy proof check lives in `stage_spend`.
- The CRE report only finalizes.

## Devnet deployment

- Program `brizo_pool`: [`HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC`](https://explorer.solana.com/address/HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC?cluster=devnet)
- Pool PDA (CRE simulator forwarder): `E4VujnAbw8qugcpogcSCaXVHC2r8qoAzeoAoDrnomNPT`
- tUSDC mint (our test token, 6 decimals): `7NfRf2AgUw3yRMSuj9EXsEJNC5nSr8RmqtrXKxv6hVFJ`
- All other accounts: [`deploy/devnet.json`](deploy/devnet.json)
- IDL: [`deploy/idl/brizo_pool.json`](deploy/idl/brizo_pool.json)

### Example transactions

- Program deploy: [`3WfQPHLX…`](https://explorer.solana.com/tx/3WfQPHLXX38eyV3qcubzJeSTUgNtRQ51Frag1LcnDzh4pqpBNEMGYJnTxnaymizCaU6FtBEXihyAi5rdGJip9fEf?cluster=devnet)
- Pool initialise: [`5vHcT85R…`](https://explorer.solana.com/tx/5vHcT85RhE1cg1ZbdRvii2Kge3UVJEqD8Tb57bK74MzEnQxF1Q9M9o83fqxoJ1uyv37A4Z6XeZV1zy56XXanx78D?cluster=devnet)
- Deposit: [`2W72FdqW…`](https://explorer.solana.com/tx/2W72FdqWyjvh6edud6HHDgV9N3xz2pb7sBCHdAhPX3BdmjByfqQKL682QfDQTrwPqC1duXbsEi3PpTDRuWWZtFay?cluster=devnet)
- Stage spend, proof verified on-chain: [`33dQtAxL…`](https://explorer.solana.com/tx/33dQtAxLJRKtMv6MACydfKTUvMfTKePeZdn2gjWmJ7HkUe2tLUUexCWfuTxZKJuzVeLQ2C3HPDBwtvzKAdWujjCy?cluster=devnet)
- Spend finalized by CRE (`brizo-spend`): [`34LDToSM…`](https://explorer.solana.com/tx/34LDToSMPhcYfboPdaetufAcPteHGR3AHigPCHUgJZRFpxrAa2991D31X1p28JksgaPu8f1z19jyqpksCBCsmDR6?cluster=devnet)
- Full question through the gateway (`brizo-request`): [`5tUUkGvm…`](https://explorer.solana.com/tx/5tUUkGvmce4YJYNedvZx5Qv2yhQWcxPNtcqzTkfriUu7ZYnd5EYf5QcPJpRNo6VF7Wbc3nz9pu6XsFDa7tB3e9ux?cluster=devnet)
- Reused credit: rejected with `NullifierUsed` at stage and at finalize (see [`docs/EVIDENCE.md`](docs/EVIDENCE.md))
- Settle, operator paid: [`56y25StB…`](https://explorer.solana.com/tx/56y25StBajhcbQRA2MxoGFY6Ayg2rzJLCg9kcpmg9Ga9FaGT1Bbspatzh7bkvgfdr64oLbLHEyTk5Usm42HqwxPR?cluster=devnet), [`3BP1wnes…`](https://explorer.solana.com/tx/3BP1wnesu38p2JRuYhqidTDHaNTBAar4fjBh297E2jznjfcVnxMKLPMhycdpT6z5mdZCmiWPbo1NfLTHkVemcNKa?cluster=devnet)

Every simulation run, its output and its signature are in [`docs/EVIDENCE.md`](docs/EVIDENCE.md).

## Quick start

### Prerequisites

- CRE CLI v1.37.0 (run `cre login` first)
- Bun 1.2.21 or newer (older Bun breaks every TS workflow with `wasm unreachable`)
- Node 23
- Solana CLI 2.3.0
- Anchor 0.31.0, plus `nightly-2025-04-15` for the IDL
- circom 2.2.3 and snarkjs 0.7.6 (only to rebuild the circuit)
- Ollama with `qwen3:8b` (for the local scrubber)

### Secrets

Nothing secret is in the repo. Copy each `.env.example` to `.env` and fill it in.

`workflows/.env`
- `CRE_SOLANA_PRIVATE_KEY`: path to a funded devnet keypair
- `CRE_ETH_PRIVATE_KEY`: keep the placeholder from the example (the CLI needs it)
- `SECRET_MODEL_API_KEY`: your OpenRouter key
- `SECRET_ENCLAVE_BOX_SK`: written by `bun run scripts/gen-enclave-key.ts`
- `SOLANA_DEVNET_RPC_URL`: a private devnet RPC (the public one returns 429 under normal load)

`gateway/.env`
- Keypair paths for the faucet and the relayer

`scripts/.env`
- Admin and faucet keypair paths for deployment

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

To build a real request from on-chain state, the same way the browser does:

```bash
npx tsx scripts/make-request.ts --i <credit index> --relayer <relayer pubkey>
```

- It writes `stage.json`, `spend.json`, `infer.json` and `ask.json` to `fixtures/requests/<id>/`.
- Stage it with:

```bash
cd ../scripts && node --env-file=.env --import tsx stage-spend.ts ../workflows/fixtures/requests/<id>/stage.json
```

### Build and test the program (from `programs/`)

```bash
NO_DNA=1 anchor build --no-idl
cd programs/brizo_pool && RUSTUP_TOOLCHAIN=nightly-2025-04-15 NO_DNA=1 \
  anchor idl build -o ../../target/idl/brizo_pool.json -t ../../target/types/brizo_pool.ts && cd ../..
NO_DNA=1 anchor test --skip-build          # 17 localnet tests, including on-chain Groth16 and the forwarder CPI
NO_DNA=1 anchor deploy --provider.cluster devnet -p brizo_pool
cd ../scripts && node --env-file=.env --import tsx init-devnet.ts   # mint, vault, accounts, pool → deploy/devnet.json
```

More detail: [`gateway/README.md`](gateway/README.md), [`frontend/README.md`](frontend/README.md), [`circuits/README.md`](circuits/README.md).

## Limits

- CRE runs in the simulator. We didn't have deployment access during the hackathon.
- Solana writes go through the simulator's forwarder, but the transactions are real devnet transactions.
- The reports fit CRE's default production limits, so deploying shouldn't need a protocol change.
- We generated the enclave key and hold it as a CRE secret. We could decrypt a scrubbed question if we intercepted it.
- Your payment hides among everyone who deposited. With few users, that's weak cover.
- Scrubbing is best effort. The local model can miss things.
- The rules only guarantee that personal values you saved don't leave your device.
- Without Ollama the app runs rules only, and your writing style leaves the device.
- The gateway sees your IP. Use Tor Browser if that matters; the demo doesn't enforce it.
- CRE gives the model call 10 seconds, so answers are capped at 600 tokens.
- On a timeout you get a sealed "model unavailable" note.
- Trusted setup: the public Hermez Powers of Tau plus one local phase-2 contribution. No public ceremony.
- Nothing is audited: circuit, program or workflows.
- The program's upgrade authority is still the deployer key.
- Capacity: 1,024 deposits, 4,096 nullifiers, 32 roots.
- tUSDC is our own devnet token, not a real stablecoin.

## Roadmap

- Deploy the workflows to a CRE DON with the real Solana forwarder.
- Run `brizo-request` as a deployed Confidential Workflow.
- Generate the enclave key inside the enclave, with attestation, so nobody holds it.
- Redeem unused credits to a fresh address.
- Privacy receipts in each settle report.
- A multi-party trusted setup ceremony.
- An audit.
- Deeper and multiple trees, compressed nullifier accounts.
- Upgrade authority moved to a multisig, or frozen.
- An agent SDK with spending caps.
- x402 top-ups.
- The gateway as a Tor onion service.

## Built at TOKEN2049 Origins

All code was written during the hackathon on 7 Oct 2026.

Templates we started from:
- `cre-templates/building-blocks/solana-read-write/solana-read-write-ts`: forwarder CPI check, report encoding, simulator forwarder values
- `cre init -t hello-confidential-workflows-ts`: the `handlerInTee` structure

Libraries:
- CRE and Solana: `@chainlink/cre-sdk`, `@solana/web3.js`, `@solana/codecs`, `zod`, `tweetnacl`, `@noble/hashes`, Anchor, `groth16-solana`, `solana-poseidon`
- ZK: circom, circomlib, snarkjs, circomlibjs
- Gateway and app: Hono, Vite, React

Models:
- `anthropic/claude-haiku-4.5` through OpenRouter, called from the enclave
- Ollama `qwen3:8b` on your own machine, for scrubbing

### Team

- [@0xr10t](https://github.com/0xr10t)
- [@akronim26](https://github.com/akronim26)
