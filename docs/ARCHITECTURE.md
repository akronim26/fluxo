# Architecture

Fluxo lets you ask an AI model a private question without your identity being attached to it. This doc walks through what it does and how a question moves through it.

![Fluxo architecture](images/architecture.png)

## One question, start to finish

1. You open the app and connect a Solana wallet. The faucet sends you 20 tUSDC and 0.02 devnet SOL.
2. You deposit 10 tUSDC. The browser makes a secret credit note, and only its commitment goes on-chain. Your wallet signs this, so the deposit itself is public.
3. You type a question. The browser scrubs it and shows you exactly what will be sent.
4. You approve it. The browser seals the question to the enclave's public key and builds a zero-knowledge proof that you own one unspent credit.
5. The gateway checks the proof, then its relayer sends `stage_spend`. The Solana program checks the proof again and records a pending spend.
6. The gateway runs the `fluxo-request` workflow. Inside the enclave, it opens your question, asks the model and seals the answer.
7. The workflow sends a `Spend` report to Solana through the CRE forwarder. The program burns the credit's nullifier.
8. Only if that worked does the sealed answer reach the gateway's mailbox.
9. The browser picks up the answer, decrypts it and fills your real details back in.

Every 10 minutes, `fluxo-settle` pays the operator for the spends that went through.

### The scrubber

It runs in two passes, both on your device.

- If Ollama is running locally, `qwen3:8b` first rewrites the question in neutral third person and drops names, employers, places, dates and numbers.
- Then fixed rules run on the result. They remove emails, exact dates and phone-like numbers. They replace your profile values: your name and private terms become `[private detail]`, your city becomes a region, and your age becomes a range.
- Without Ollama only the rules run, and the review screen says that your writing style isn't hidden in that mode.

### Credit notes

- A note holds `secret`, `nk`, the leaf index and `nextI`, the number of the next credit to spend (0 to 199).
- Notes live in `localStorage`. Nothing about them leaves the browser.
- Backups are encrypted with `AES-GCM`, using a key derived from your password (PBKDF2, 310,000 rounds, at least 12 characters).

### Sending a question safely

- The proving files (`credit.wasm`, `credit_final.zkey`) are checked against SHA-256 hashes from `/api/config` before use.
- A browser lock per pool stops two tabs from spending the same credit.
- The credit is marked as used before the request is sent. If anything fails after that, it is never retried, because the nullifier may already be on-chain.
- The answer's nonce must match `sha256(requestId ‖ clientPub ‖ "answer")`, or the answer is rejected.

### Personalising the answer

The model answers in JSON with a general answer plus branches, for example "if age < 40, do X". The browser checks each branch against your real age or city and shows only the ones that apply. The model never sees those values.

## Gateway

A Bun + Hono server with two ports. The public API is on `:8788`. The mailbox is on `:8787` and must never be exposed.

| Route | Job |
|---|---|
| `GET /api/config` | Pool addresses, enclave public key, proving file URLs and hashes |
| `GET /circuits/:name` | Serves `credit.wasm` and `credit_final.zkey` |
| `POST /api/faucet` | Mints 20 tUSDC and sends 0.02 SOL, once per wallet per hour |
| `POST /api/ask` | Verifies the proof, stages the spend, runs `fluxo-request` |
| `POST /mailbox/:id` | The enclave drops the sealed answer here |
| `GET /api/answer/:id` | Returns the sealed answer once, then forgets it |

- Requests and answers are kept in SQLite. Answers expire, and can only be read once.
- `/api/ask` handles one request at a time, so CRE simulations never collide.
- The proof check uses snarkjs. The relayer transaction is built in `scripts/stage-spend.mjs`, which also runs on its own for staging by hand. The faucet shells out to the `spl-token` and `solana` CLIs.
- `cre.ts` runs `cre workflow simulate` on the prebuilt `workflows/build/fluxo-request.wasm` and reads the spend signature from its output.

## Solana program

The program holds the money and enforces every rule.

- `initialize` sets up the pool, the tree and the two large accounts, and records which forwarder may call `on_report`.
- `deposit` takes exactly 10 tUSDC and adds your commitment to a depth-10 Poseidon tree (the `sol_poseidon` syscall). It keeps the last 32 roots. Every leaf is also stored in `Leaves`, so the browser can rebuild the tree without an indexer.
- `stage_spend` verifies the Groth16 proof on-chain with `groth16-solana` (about 120k compute units). It checks that the root is recent and the nullifier unused, then records a `PendingSpend`. The relayer pays its rent.
- `on_report` only accepts calls from the CRE forwarder. It handles two reports:
  - `Spend { nullifier_hash, request_binding }` (65 bytes) must match a staged spend. It burns the nullifier, counts the spend and refunds the relayer's rent.
  - `Settle { epoch }` pays the operator 0.05 tUSDC for every spend not yet paid.

`test_forwarder` stands in for the CRE forwarder in the Anchor tests.

## CRE workflows

| Workflow | Trigger | Job |
|---|---|---|
| `fluxo-request` | HTTP, runs in the enclave | Opens the question, calls the model, seals the answer, finalizes the spend, then delivers the answer |
| `fluxo-settle` | Cron, every 10 minutes | Pays the operator |

The shared code is in `lib/`:

- `fluxo.ts` covers request binding, report encoding and byte helpers.
- `infer.ts` covers the model call through OpenRouter and sealing the answer.
- `solana.ts` builds the `writeReport` account lists and derives the `PendingSpend` address.

Inside the enclave, the workflow reads two secrets: `MODEL_API_KEY` and `ENCLAVE_BOX_SK`. The model is `anthropic/claude-haiku-4.5`, capped at 600 tokens because CRE gives the HTTP call 10 seconds. Only the sealed answer crosses back out of the enclave.

`scripts/` holds helpers: `build-wasm.sh` compiles both workflows, `make-request.ts` builds a real request from on-chain state, `apply-devnet-config.ts` writes addresses into each `config.simulation.json`, and `settle-loop.sh` runs settle on a timer.

## Circuit

`credit.circom` proves three things without revealing your note:

- your commitment `Poseidon(secret, nk)` is in a tree with a recent `root`
- `nullifierHash = Poseidon(nk, i)` for some credit number `i` below 200
- the proof is bound to this exact request through `requestBinding`

`build/` holds what the rest of the repo uses:

- `credit.wasm` and `credit_final.zkey` for the browser
- `verification_key.json` for the gateway
- test vectors and sample proofs for the tests

`scripts/prove.mjs` regenerates the test fixtures and writes the verifying key straight into the program. `rust-check/` is a small native Rust check that the same proofs verify with `groth16-solana`.

The setup is the public Hermez Powers of Tau plus one local phase-2 contribution. `setup-provenance.json` records both.

## How a proof is tied to one request

- `requestBinding = sha256(requestId ‖ ciphertext) mod r`. A proof made for one question can't be attached to another.
- The enclave recomputes the binding before it opens anything, and `on_report` checks that it matches the staged spend.
- The same credit always gives the same nullifier, so spending it twice fails with `NullifierUsed`.
- The answer is sealed to a one-time key the browser made for this request. The enclave has no randomness, so the nonce is derived from the request.

## Why the proof is checked in `stage_spend`

CRE's default Solana limits are a 265-byte report and 300k compute units. The proof alone is 256 bytes, so it doesn't fit in a report. The heavy check happens in a normal transaction instead, and the CRE report carries only the 65-byte `Spend` that finalizes it. A misbehaving forwarder still can't create a spend, because nothing gets finalized without a staged, verified proof.

## Who sees what

| Party | Sees | Doesn't see |
|---|---|---|
| Your browser | Everything | |
| Gateway | IP, ciphertext, proof, timing | Plaintext, which deposit paid |
| CRE nodes | Workflow code, chain writes, nullifier, sealed answer | Decrypted question, answer, API key |
| Enclave | Scrubbed question, answer, API key | Your raw data, your wallet |
| Model provider | Scrubbed question | Who asked |
| Solana | Deposits, nullifiers, payouts | Which deposit paid for which question |

We generated the enclave key ourselves and store it as a CRE secret. For now that makes us a party that could read a scrubbed question if we intercepted it.

## Deployment

- The program runs on Solana devnet at `HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC`. `deploy/devnet.json` lists every account, and `scripts/init-devnet.ts` created them.
- `scripts/deposit.ts` deposits a fixed test note (secret 123, nk 456). `workflows/scripts/make-request.ts` expects that note at leaf 0 and uses it to build requests without a browser.
- CRE runs through `cre workflow simulate`. Its Solana writes are real devnet transactions, sent through the simulator's forwarder.
- tUSDC is our own devnet token with 6 decimals.
