# Brizo

**Ask frontier AI models about private matters without identifying yourself.**

Every AI request normally identifies you three ways: **what you write**, **how you pay**, and **who can see the request on its way to the model**. Brizo closes all three:

| Leak | Brizo's fix |
|---|---|
| What you write | A two-layer scrubber on your device. A local model (Ollama) rewrites and splits the question in a neutral voice; deterministic rules then generalise structured fields and block sending if a known personal value survives. The model's branched answer is filled in with your real values in the browser. |
| How you pay | Zero-knowledge credits on Solana. You deposit 10 tUSDC once for 200 credits. Each question spends one credit with a Groth16 proof that you own *some* unspent deposit, plus a one-time nullifier. The Solana program verifies every proof on-chain. |
| Who sees the request in transit | The scrubbed question is encrypted to a **Chainlink CRE Confidential Workflow**. The model is called from inside the enclave, with an API key that exists only there, and the answer is encrypted back to you. |

Built at TOKEN2049 Origins (7 Oct 2026) for the Chainlink **Best workflow with CRE** and Solana **Best Use of Solana** tracks.

---

## Architecture

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

## Who sees what

| Observer | Sees | Does not see |
|---|---|---|
| Model provider (via OpenRouter) | A generic, scrubbed question from the enclave's API account | Your identity, raw data, wallet, IP |
| Gateway (our server) | Your IP, ciphertext, the ZK proof, timing | Plaintext question or answer, which deposit paid |
| CRE node operators | Workflow code, triggers, chain writes, the nullifier and binding, the *sealed* answer | Decrypted question, model answer, API key |
| Our team | Same as the gateway. We generated the enclave box key and hold it as a CRE secret, so we *could* decrypt intercepted scrubbed questions. | Raw data, which never leaves your device |
| Anyone reading Solana | Deposits (wallet + amount), nullifiers, settlement amounts | Which deposit paid for which question |

---

## How CRE and Solana divide the work

**Solana (`programs/brizo_pool`, Anchor 0.31)** holds the money and enforces every rule:
- **`deposit`:** exactly 10 tUSDC into the vault; the commitment goes into a depth-10 Poseidon Merkle tree (the `sol_poseidon` syscall), with a 32-root history.
- **`stage_spend`:** verifies the Groth16 credit proof on-chain (`groth16-solana`, compressed points, ~120k CU) against a recent root and an unspent nullifier, then records a `PendingSpend` PDA.
- **`on_report`**, callable only through the CRE keystone forwarder (the `verify_forwarder_cpi` check from the CRE template):
  - `Spend { nullifier_hash, request_binding }` (65 B): the binding must equal the staged one; burns the nullifier (`NullifierUsed` on reuse), counts the spend, refunds the relayer's rent.
  - `Settle { epoch }`: pays the operator `(spends − claimed) × 0.05 tUSDC` from the vault.

Even a misbehaving forwarder can't create a spend, because the proof is verified on-chain.

**CRE (`workflows/`, TypeScript, `@chainlink/cre-sdk` 1.23.0)** is the orchestration and confidentiality layer:

| Workflow | Trigger | Role |
|---|---|---|
| `brizo-request` | HTTP, **`handlerInTee`** | Main path. In the enclave: binding check, `nacl.box.open`, model call through `HTTPClient` + `TeeRuntime` with the `MODEL_API_KEY` Vault secret, `nacl.box` seal. Crosses back with `usingTheDons()` carrying only the sealed ciphertext, finalizes the spend with `SolanaClient.writeReport`, and posts the answer only if payment landed. |
| `brizo-spend` | HTTP | Spend finalize alone (two-step path) |
| `brizo-infer` | HTTP, `handlerInTee` | Confidential answer alone (two-step path) |
| `brizo-settle` | Cron `0 */10 * * * *` | Settle report → operator payout |

The Spend report was designed to fit CRE's **default** Solana limits: 265 B signed report and 300k CU. That's why the proof is verified in `stage_spend` and the CRE report only finalizes.

---

## Deployed on Solana devnet

| Item | Address |
|---|---|
| Program `brizo_pool` | [`HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC`](https://explorer.solana.com/address/HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC?cluster=devnet) |
| Pool PDA (CRE simulator mock forwarder) | `E4VujnAbw8qugcpogcSCaXVHC2r8qoAzeoAoDrnomNPT` |
| tUSDC mint (6 decimals, ours) | `7NfRf2AgUw3yRMSuj9EXsEJNC5nSr8RmqtrXKxv6hVFJ` |
| Tree PDA / Leaves / NullifierSet | `J4uUU49D…` / `EfSCPTpc…` / `EMqup2tD…` |
| Vault / Operator token accounts | `62hvjRCm…` / `Edk22EeX…` |

Everything is in [`deploy/devnet.json`](deploy/devnet.json); the IDL is in [`deploy/idl/brizo_pool.json`](deploy/idl/brizo_pool.json).

### Example transactions (devnet)

| Type | Transaction |
|---|---|
| Program deploy | [`3WfQPHLX…`](https://explorer.solana.com/tx/3WfQPHLXX38eyV3qcubzJeSTUgNtRQ51Frag1LcnDzh4pqpBNEMGYJnTxnaymizCaU6FtBEXihyAi5rdGJip9fEf?cluster=devnet) |
| Pool initialise | [`5vHcT85R…`](https://explorer.solana.com/tx/5vHcT85RhE1cg1ZbdRvii2Kge3UVJEqD8Tb57bK74MzEnQxF1Q9M9o83fqxoJ1uyv37A4Z6XeZV1zy56XXanx78D?cluster=devnet) |
| Deposit | [`2W72FdqW…`](https://explorer.solana.com/tx/2W72FdqWyjvh6edud6HHDgV9N3xz2pb7sBCHdAhPX3BdmjByfqQKL682QfDQTrwPqC1duXbsEi3PpTDRuWWZtFay?cluster=devnet) |
| Stage spend (Groth16 verified on-chain) | [`33dQtAxL…`](https://explorer.solana.com/tx/33dQtAxLJRKtMv6MACydfKTUvMfTKePeZdn2gjWmJ7HkUe2tLUUexCWfuTxZKJuzVeLQ2C3HPDBwtvzKAdWujjCy?cluster=devnet) |
| Spend finalized by CRE (`brizo-spend`) | [`34LDToSM…`](https://explorer.solana.com/tx/34LDToSMPhcYfboPdaetufAcPteHGR3AHigPCHUgJZRFpxrAa2991D31X1p28JksgaPu8f1z19jyqpksCBCsmDR6?cluster=devnet) |
| Full question through the gateway (`brizo-request`: TEE answer + spend) | [`5tUUkGvm…`](https://explorer.solana.com/tx/5tUUkGvmce4YJYNedvZx5Qv2yhQWcxPNtcqzTkfriUu7ZYnd5EYf5QcPJpRNo6VF7Wbc3nz9pu6XsFDa7tB3e9ux?cluster=devnet) |
| Reused credit | Rejected with `NullifierUsed` at both stage and finalize (output in [`docs/EVIDENCE.md`](docs/EVIDENCE.md)) |
| Settle (operator paid) | [`56y25StB…`](https://explorer.solana.com/tx/56y25StBajhcbQRA2MxoGFY6Ayg2rzJLCg9kcpmg9Ga9FaGT1Bbspatzh7bkvgfdr64oLbLHEyTk5Usm42HqwxPR?cluster=devnet), [`3BP1wnes…`](https://explorer.solana.com/tx/3BP1wnesu38p2JRuYhqidTDHaNTBAar4fjBh297E2jznjfcVnxMKLPMhycdpT6z5mdZCmiWPbo1NfLTHkVemcNKa?cluster=devnet) |

Every simulation command, its output and each signature are logged in [`docs/EVIDENCE.md`](docs/EVIDENCE.md).

---

## Setup

### Prerequisites

- **CRE CLI** v1.37.0 (`cre login`)
- **Bun ≥ 1.2.21.** Older Bun makes every TS workflow fail with `wasm unreachable`.
- **Node 23**
- **Solana CLI 2.3.0**
- **Anchor 0.31.0** + `nightly-2025-04-15` (for the IDL only)
- circom 2.2.3 / snarkjs 0.7.6 (circuits only)
- Ollama with `qwen3:8b` for the local scrubber

### Secrets and environment (never committed)

Each directory has a `.env.example`; copy it to `.env` and fill in:

- **`workflows/.env`**
  - `CRE_SOLANA_PRIVATE_KEY`: path to a funded devnet keypair; pays simulation broadcast fees.
  - `CRE_ETH_PRIVATE_KEY`: the placeholder from `.env.example` (required by the CLI).
  - `SECRET_MODEL_API_KEY`: OpenRouter key.
  - `SECRET_ENCLAVE_BOX_SK`: written by `bun run scripts/gen-enclave-key.ts`, which prints only the public key into `workflows/enclave-public-key.json`.
  - `SOLANA_DEVNET_RPC_URL`: a **private devnet** RPC. The public endpoint returns 429 under normal load.
- **`gateway/.env`**: keypair paths for the faucet mint authority and the `stage_spend` relayer (see `gateway/.env.example`).
- **`scripts/.env`**: admin and faucet keypair paths for deployment.

### Install

```bash
cd workflows && bun install && ./scripts/build-wasm.sh   # compiles all four workflows once
cd ../gateway && bun install
cd ../frontend && npm install
cd ../circuits && npm ci --ignore-scripts
```

## Commands

### CRE simulations (run from `workflows/`)

```bash
# one paid question: TEE answer + Solana spend finalize (after the relayer's stage_spend)
cre workflow simulate ./brizo-request --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/request.json --broadcast --wasm "$PWD/build/brizo-request.wasm"

# spend finalize alone / confidential answer alone (two-step path)
cre workflow simulate ./brizo-spend  --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/spend.json --broadcast --wasm "$PWD/build/brizo-spend.wasm"
cre workflow simulate ./brizo-infer  --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/requests/<id>/infer.json --wasm "$PWD/build/brizo-infer.wasm"

# settle: pay the operator for finalized spends
cre workflow simulate ./brizo-settle --target simulation-settings --non-interactive --trigger-index 0 \
  --broadcast --wasm "$PWD/build/brizo-settle.wasm"

# keep settling on the cron cadence (stands in for the DON scheduler in simulation)
./scripts/settle-loop.sh
```

To build a real request from on-chain state the way the browser does (rebuilt tree, sealed envelope, binding, Groth16 proof), run this from `workflows/`:

```bash
npx tsx scripts/make-request.ts --i <credit index> --relayer <relayer pubkey>
```

It writes `stage.json`, `spend.json`, `infer.json` and `ask.json` under `fixtures/requests/<id>/`. Stage it with:

```bash
cd ../scripts && node --env-file=.env --import tsx stage-spend.ts ../workflows/fixtures/requests/<id>/stage.json
```

### Solana program (run from `programs/`)

```bash
NO_DNA=1 anchor build --no-idl
cd programs/brizo_pool && RUSTUP_TOOLCHAIN=nightly-2025-04-15 NO_DNA=1 \
  anchor idl build -o ../../target/idl/brizo_pool.json -t ../../target/types/brizo_pool.ts && cd ../..
NO_DNA=1 anchor test --skip-build          # 17 localnet tests, incl. on-chain Groth16 and the forwarder CPI
NO_DNA=1 anchor deploy --provider.cluster devnet -p brizo_pool
cd ../scripts && node --env-file=.env --import tsx init-devnet.ts   # mint, vault, large accounts, pool → deploy/devnet.json
```

### Gateway and app

```bash
cd gateway && bun run src/server.ts      # public API :8788, private mailbox :8787
cd frontend && npm run dev               # http://127.0.0.1:5173
```

See [`gateway/README.md`](gateway/README.md), [`frontend/README.md`](frontend/README.md) and [`circuits/README.md`](circuits/README.md) for details.

---

## Honest limits

- **CRE runs in the simulator.** Deployment access wasn't available to us during the hackathon, so every workflow runs with `cre workflow simulate`, and Solana writes go through CRE's simulator mock forwarder on devnet. **The Solana transactions are real devnet transactions.** The design fits CRE's default production limits (65-byte Spend report, about 13k CU finalize), so deploying it would need no protocol change.
- **The enclave key is ours.** We generated the enclave's box key and hold it as a CRE secret, so we could decrypt intercepted scrubbed questions. Attested in-enclave key generation is on the roadmap.
- **The anonymity set is everyone who deposited.** With few users, payment privacy is weak.
- **Scrubbing is best-effort.** The local model can miss a detail, and the rules only guarantee that *known* profile values don't leave the device. In rules-only mode (no local model), your writing style still leaves the device.
- **The gateway sees your IP.** Use Tor Browser for network privacy; the hosted demo doesn't enforce it.
- **The model call has a 10-second budget** (CRE's HTTP action timeout), so answers are capped at 600 tokens. A timeout delivers a sealed "model unavailable" notice.
- **Trusted setup:** the public Hermez Powers of Tau plus a **single local phase-2 contribution**, not a public ceremony.
- **Unaudited** circuit, program and workflows. The program's upgrade authority is the deployer key.
- **Capacity:** 1,024 deposits, 4,096 nullifiers, 32-root history.
- **tUSDC is our own devnet test token**, not a real stablecoin.

## Roadmap

- Deploy the workflows to a CRE DON with the real Solana forwarder, and `brizo-request` with Confidential Workflows.
- Attested in-enclave key generation, so nobody, including us, holds the box key.
- Redeem unused credits to a fresh address (direct `redeem` instruction).
- Privacy receipts: a salted per-epoch receipts root in `Settle`.
- A public multi-party trusted-setup ceremony; an audit of the circuit, program and workflows.
- Deeper trees, several trees, compressed nullifier accounts.
- Upgrade authority moved to a multisig or frozen.
- An agent SDK with spending caps; x402 top-ups; the gateway as a Tor onion service.

---

## Hackathon statement

All code was written during TOKEN2049 Origins on 7 Oct 2026.

**Templates used:**
- Chainlink `cre-templates` `building-blocks/solana-read-write/solana-read-write-ts`: forwarder-CPI check, report encoding, simulator mock forwarder values.
- `cre init -t hello-confidential-workflows-ts`: the `handlerInTee` structure.

**Libraries:**
- CRE and Solana: `@chainlink/cre-sdk`, `@solana/web3.js`, `@solana/codecs`, `zod`, `tweetnacl`, `@noble/hashes`, Anchor, `groth16-solana`, `solana-poseidon`.
- ZK: circom/circomlib, snarkjs, circomlibjs.
- Gateway and app: Hono, Vite/React.

Models: OpenRouter (`anthropic/claude-haiku-4.5`) from the enclave, and Ollama `qwen3:8b` on the user's device.
