# Architecture

Fluxo has five parts: the browser app, a small gateway, a Solana program, a set of Chainlink CRE workflows, and the model provider. Each one sees as little as it needs to.

![Fluxo architecture](../public/architecture.png)

## Components

### Browser app (`frontend/`)

The browser is the only place your raw data lives.

- Scrubs the question in two passes. A local model (Ollama, `qwen3:8b`) rewrites it in a neutral voice. Rules then turn exact values into bands and block the send if a saved personal value is still there.
- Holds your credit note (`secret`, `nk`, leaf index, next credit number).
- Rebuilds the deposit tree from the on-chain `Leaves` account and makes a Groth16 proof with snarkjs.
- Seals the scrubbed question to the enclave's public key with `nacl.box`, using a fresh key pair for every request.
- Decrypts the answer and picks the branch that matches your real values.

### Gateway (`gateway/`)

A Bun + Hono server. It sees your IP and ciphertext, never plaintext.

| Route | Job |
|---|---|
| `POST /api/faucet` | Sends test tUSDC and a little devnet SOL |
| `POST /api/ask` | Checks the proof off-chain, relays `stage_spend`, runs the CRE workflow |
| `POST /mailbox/:id` | Receives the sealed answer from the enclave (private port) |
| `GET /api/answer/:id` | Hands the sealed answer back to the browser |
| `GET /api/config` | Pool addresses, enclave public key, circuit files |

The public API runs on `:8788` and the mailbox on `:8787`.

### Solana program (`programs/fluxo_pool`)

The program holds the money and enforces the rules.

- `deposit` takes exactly 10 tUSDC and adds the commitment to a depth-10 Poseidon tree. It keeps the last 32 roots.
- `stage_spend` verifies the Groth16 proof on-chain, checks the root and nullifier, and records a `PendingSpend`. The relayer pays the rent.
- `on_report` only accepts calls from the CRE forwarder. It handles two reports:
  - `Spend { nullifier_hash, request_binding }` must match a staged spend. It burns the nullifier, counts the spend and refunds the relayer.
  - `Settle { epoch }` pays the operator 0.05 tUSDC for every spend not yet paid.

### CRE workflows (`workflows/`)

| Workflow | Trigger | Job |
|---|---|---|
| `fluxo-request` | HTTP, runs in the enclave | Opens the question, calls the model, seals the answer, finalizes the spend, then delivers the answer |
| `fluxo-spend` | HTTP | Finalizes a spend on its own |
| `fluxo-infer` | HTTP, runs in the enclave | Produces the sealed answer on its own |
| `fluxo-settle` | Cron, every 10 minutes | Pays the operator |

`fluxo-spend` and `fluxo-infer` are the two-step version of `fluxo-request`.

### Model provider

The enclave calls `anthropic/claude-haiku-4.5` through OpenRouter. The provider only sees the scrubbed question, sent from the enclave's account.

## One question, step by step

1. You deposit 10 tUSDC once. Your wallet signs, so this step is public.
2. You type a question. The browser scrubs it and shows you the diff.
3. The browser proves you own one unspent credit and seals the question.
4. The gateway checks the proof, then a relayer sends `stage_spend`. Solana verifies the proof again, on-chain.
5. The gateway starts `fluxo-request`. Inside the enclave, the workflow checks the binding, opens the question, calls the model and seals the answer.
6. The workflow sends a `Spend` report through the forwarder. Solana burns the nullifier.
7. Only if that landed does the sealed answer go to the gateway mailbox.
8. The browser picks it up and decrypts it locally.

Every 10 minutes, `fluxo-settle` pays the operator for the spends that went through.

## How a proof is tied to one request

The circuit has three public inputs: `root`, `nullifierHash` and `requestBinding`.

- `nullifierHash = Poseidon(nk, i)`, where `i` is the credit number (below 200). Same credit, same nullifier, so reuse fails.
- `requestBinding = sha256(requestId ‖ ciphertext) mod r`. A proof made for one question can't be attached to another.
- The enclave recomputes the binding before it opens anything.

The answer is sealed with `nacl.box` to the browser's one-time key. The nonce is the first 24 bytes of `sha256(requestId ‖ clientPub ‖ "answer")`, because the enclave has no source of randomness.

## Why the proof is checked in `stage_spend`

CRE's default Solana limits are a 265-byte report and 300k compute units. The proof alone is 256 bytes, so it doesn't fit in a report. So the heavy check happens in a normal transaction (`stage_spend`, about 120k CU), and the CRE report only carries the 65-byte `Spend` that finalizes it. A misbehaving forwarder still can't create a spend, because the program won't finalize anything that wasn't staged with a valid proof.

## Trust boundaries

| Party | Sees | Doesn't see |
|---|---|---|
| Browser | Everything | |
| Gateway | IP, ciphertext, proof, timing | Plaintext, which deposit paid |
| CRE nodes | Workflow code, chain writes, nullifier, sealed answer | Decrypted question, answer, API key |
| Enclave | Scrubbed question, answer, API key | Your raw data, your wallet |
| Model provider | Scrubbed question | Who asked |
| Solana | Deposits, nullifiers, payouts | Which deposit paid for which question |

We generated the enclave key ourselves and store it as a CRE secret, so for now we're also a party that could read a scrubbed question if we intercepted it.

## Numbers

| Thing | Value |
|---|---|
| Deposit | 10 tUSDC (6 decimals) |
| Credits per deposit | 200 |
| Price per credit | 0.05 tUSDC |
| Tree depth | 10 (1,024 deposits) |
| Root history | 32 |
| Nullifier capacity | 4,096 |
| Answer cap | 600 tokens (10-second model budget) |
