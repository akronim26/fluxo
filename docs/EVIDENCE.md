# Evidence log

Record every spike result, deployment and transaction here as it happens. Never paste secrets, keypairs or API keys.

## Spikes

| # | Result | Notes |
|---|---|---|
| S1 | **pass** | `handlerInTee` + HTTP trigger simulated with `--http-payload` (lane A, `spikes/s1`) |
| S2 | **pass** | CRE `solana-read-write` template broadcast on devnet, tx `348UzUCz…` (lane A) |
| S3 | **pass** | A TEE handler crosses back with `usingTheDons()` and writes to Solana, tx `5JfcRJcQ…` (lane A) |
| S4 | **pass** | `tweetnacl` box/open + `@noble/hashes` sha256 inside the enclave (lane A, `spikes/s4`) |
| S5 | **pass** | `groth16-solana` + Poseidon syscall with the template pins; on-chain verify 112–120k CU (lane B; see Lane B section) |
| S6 | **pass** | Real model call (OpenRouter, Haiku 4.5) from the TEE handler with `MODEL_API_KEY` (lane A) |
| S7 | | |

## Deployments (devnet)

| Item | Address / signature | Explorer |
|---|---|---|
| brizo_pool program ID | `HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC` (deploy tx `3WfQPHLX…Jip9fEf`) | [program](https://explorer.solana.com/address/HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC?cluster=devnet) · [deploy tx](https://explorer.solana.com/tx/3WfQPHLXX38eyV3qcubzJeSTUgNtRQ51Frag1LcnDzh4pqpBNEMGYJnTxnaymizCaU6FtBEXihyAi5rdGJip9fEf?cluster=devnet) |
| Pool PDA (mock forwarder) | `E4VujnAbw8qugcpogcSCaXVHC2r8qoAzeoAoDrnomNPT` (init tx `5vHcT85R…XXanx78D`) | [pool](https://explorer.solana.com/address/E4VujnAbw8qugcpogcSCaXVHC2r8qoAzeoAoDrnomNPT?cluster=devnet) · [init tx](https://explorer.solana.com/tx/5vHcT85RhE1cg1ZbdRvii2Kge3UVJEqD8Tb57bK74MzEnQxF1Q9M9o83fqxoJ1uyv37A4Z6XeZV1zy56XXanx78D?cluster=devnet) |
| tUSDC mint | `7NfRf2AgUw3yRMSuj9EXsEJNC5nSr8RmqtrXKxv6hVFJ` (6 decimals) | [mint](https://explorer.solana.com/address/7NfRf2AgUw3yRMSuj9EXsEJNC5nSr8RmqtrXKxv6hVFJ?cluster=devnet) |
| Leaves account | `EfSCPTpcDVGUNqQdD2dBZAp6q4NjDNueRc8yAqPCBtGm` | [leaves](https://explorer.solana.com/address/EfSCPTpcDVGUNqQdD2dBZAp6q4NjDNueRc8yAqPCBtGm?cluster=devnet) |
| NullifierSet account | `EMqup2tDeub8koGiajPDuf8saBQypU6AKeL4uGQmkfDR` | [nullifiers](https://explorer.solana.com/address/EMqup2tDeub8koGiajPDuf8saBQypU6AKeL4uGQmkfDR?cluster=devnet) |
| Tree PDA | `J4uUU49Dngp4XnmTTdHRiui9ZgKFc9LyuYaB9mCgJ2Ly` | |
| Vault (pool PDA's tUSDC ATA) | `62hvjRCm6X9Y2b5YbziDDJUjCp3bM5cta1nDg6CbKJ6S` | |
| Operator tUSDC account | `Edk22EeXTJ1RaP5kTGTs4QsejjSZ2tE692PwJfPDMCi1` | |

## Transactions and simulations

| Time (SGT) | Type | Command | Signature / result |
|---|---|---|---|
| 17:0x | Program deploy | `anchor deploy --provider.cluster devnet -p brizo_pool` | [`3WfQPHLX…`](https://explorer.solana.com/tx/3WfQPHLXX38eyV3qcubzJeSTUgNtRQ51Frag1LcnDzh4pqpBNEMGYJnTxnaymizCaU6FtBEXihyAi5rdGJip9fEf?cluster=devnet) |
| 17:0x | Pool initialise (mock forwarder) | `scripts/init-devnet.ts` | [`5vHcT85R…`](https://explorer.solana.com/tx/5vHcT85RhE1cg1ZbdRvii2Kge3UVJEqD8Tb57bK74MzEnQxF1Q9M9o83fqxoJ1uyv37A4Z6XeZV1zy56XXanx78D?cluster=devnet) |
| 17:1x | Deposit (leaf 0, root `076981d9…ef65b9`) | `scripts/deposit.ts` | [`2W72FdqW…`](https://explorer.solana.com/tx/2W72FdqWyjvh6edud6HHDgV9N3xz2pb7sBCHdAhPX3BdmjByfqQKL682QfDQTrwPqC1duXbsEi3PpTDRuWWZtFay?cluster=devnet) |
| 17:11 | **Spend: Groth16 verified on-chain via CRE** | `cre workflow simulate ./brizo-spend … --limits … --broadcast` | [`19tuaoDA…`](https://explorer.solana.com/tx/19tuaoDA38hgoKo29WXjoJZJn7eA71U3AJySYqG1E93RpFroKGrDSQsSrFqhrzxj7n9BX39EGe64PzPQcMSm8bf?cluster=devnet): `SUCCESS`. Receiver 114,392 CU of 190,100; tx 1,141 bytes |
| 17:12 | **Reused credit rejected** | same payload replayed | `{"txStatus":"0","error":"NullifierUsed (0x1776)"}` |
| 17:12 | **Settle: operator paid for 1 verified spend** | `cre workflow simulate ./brizo-settle … --broadcast` | [`56y25StB…`](https://explorer.solana.com/tx/56y25StBajhcbQRA2MxoGFY6Ayg2rzJLCg9kcpmg9Ga9FaGT1Bbspatzh7bkvgfdr64oLbLHEyTk5Usm42HqwxPR?cluster=devnet): `SUCCESS`, epoch 2985607. Operator 0.05 tUSDC, vault 9.95 |
| ~17:50 | Program upgrade (D6 two-phase spend) | `solana program deploy … --program-id brizo_pool-keypair.json` | [`25hULWGo…`](https://explorer.solana.com/tx/25hULWGoH8oiFTNcrQ2V8siDUDWBrrQjebN353VnNkfehS4x8iURYsnSfBApURYYPrQc1GKKdjCsvUKkdTjL61s1?cluster=devnet) |
| ~18:00 | **Stage: Groth16 verified on-chain** (fresh proof, `i=1`, built from on-chain Leaves/Tree) | `scripts/stage-spend.ts` | [`33dQtAxL…`](https://explorer.solana.com/tx/33dQtAxLJRKtMv6MACydfKTUvMfTKePeZdn2gjWmJ7HkUe2tLUUexCWfuTxZKJuzVeLQ2C3HPDBwtvzKAdWujjCy?cluster=devnet) |
| 18:00 | **Spend finalize through CRE, default limits** (33 B report) | `cre workflow simulate ./brizo-spend … --broadcast` (no `--limits`) | [`34LDToSM…`](https://explorer.solana.com/tx/34LDToSMPhcYfboPdaetufAcPteHGR3AHigPCHUgJZRFpxrAa2991D31X1p28JksgaPu8f1z19jyqpksCBCsmDR6?cluster=devnet): `SUCCESS` |
| 18:01 | **Reused credit rejected, both phases** | same payloads replayed | finalize `NullifierUsed (0x1776)`; stage `Error Code: NullifierUsed` |
| ~19:38 | Program upgrade (finalize checks `request_binding`) | `solana program write-buffer` + `solana program upgrade` (private devnet RPC, `--use-rpc`) | [`67JmmDWq…`](https://explorer.solana.com/tx/67JmmDWqFdynPjshcPieTB1aisK9D5iugPU18FHvFixj7XXMJxZYhKTDBqtsi8JHo44PhxohJrCWmUqv5b3s47pw?cluster=devnet) |
| 19:43 | **E15 `brizo-request`: TEE answer + spend finalize in one workflow** (credit `i=2`) | `cre workflow simulate ./brizo-request … --broadcast --wasm build/brizo-request.wasm` | [`2Q49p6fW…`](https://explorer.solana.com/tx/2Q49p6fWneo2JRh4MzVpAMiYVe3nz9fsm3SVeFheBop4uuwqQkWZxzqSnhg8UwTKfH5dePyCrg3D6aVWLTuuzabA?cluster=devnet): `model ok`, spend `SUCCESS` under default limits |
| ~19:45 | **Full flow through the gateway** (credit `i=4`): `/api/ask` → relayer `stage_spend` → `brizo-request` → mailbox → `/api/answer` → client decrypt | `curl -X POST /api/ask` + poll `/api/answer/:id` | spend [`5tUUkGvm…`](https://explorer.solana.com/tx/5tUUkGvmce4YJYNedvZx5Qv2yhQWcxPNtcqzTkfriUu7ZYnd5EYf5QcPJpRNo6VF7Wbc3nz9pu6XsFDa7tB3e9ux?cluster=devnet). 14 s end to end; the decrypted answer is `ok:true`, `anthropic/claude-haiku-4.5`; a second read returns `410 answer_gone` |
| ~19:46 | **Reused credit refused through the gateway** (same `i=4`, new requestId) | `/api/ask` | `{"error":"stage_refused"}`: `stage_spend` fails `NullifierUsed` on-chain |
| ~19:46 | Settle (operator paid for finalized spends) | `cre workflow simulate ./brizo-settle … --broadcast --wasm …` | [`3BP1wnes…`](https://explorer.solana.com/tx/3BP1wnesu38p2JRuYhqidTDHaNTBAar4fjBh297E2jznjfcVnxMKLPMhycdpT6z5mdZCmiWPbo1NfLTHkVemcNKa?cluster=devnet): operator 0.4 tUSDC, vault 39.6 |

## Lane A — CRE

**Times in this section are IST (UTC+05:30, the machine clock), not SGT. Add 2 h 30 min for SGT.** The CLI's `[USER LOG]` timestamps ending in `Z` are also IST. Example: S2's 10:08 IST = 12:38 SGT.

Environment: CRE CLI v1.37.0, Bun 1.4.2 (upgraded from 1.2.16 — see below), `@chainlink/cre-sdk` 1.18.0 for confidential spikes.

### Account

- 09:40 `cre whoami`: logged in, org `My Org`, **Deploy Access: Not enabled**.
- 09:40 `cre account access`: "Deployment access is not yet enabled for your organization." The command then prompts for a request form and needs an interactive terminal; not submitted. E16 is blocked until access is granted.

### Spikes

| Spike | Time | Result | Notes |
|---|---|---|---|
| Toolchain | 09:52 | fixed | Every TS workflow (even untouched `hello-world-ts`) failed with `Failed to create engine: failed to execute subscribe ... wasm trap: wasm unreachable instruction executed`. Cause: Bun 1.2.16 (CRE needs ≥ 1.2.21). `bun upgrade` to 1.4.2 fixed it. **Every lane that compiles CRE workflows (A, and C's gateway host) needs Bun ≥ 1.2.21.** |
| S2 | 10:08 | **pass** | Template `building-blocks/solana-read-write/solana-read-write-ts` (cre-templates@d0223f3, cloned to `spikes/s2/tpl`, not committed), unmodified, write cron with `--broadcast`. Devnet tx [`348UzUCz…pB5ED`](https://explorer.solana.com/tx/348UzUCzJXLFTQb52fgCrBawUtBZWhWDBeR9Z5BaAirZ3sJyG2Q7BoQjx7wFvs9qNRayprDETek2UGoGxoRpB5ED?cluster=devnet). Transmitter (simulation fee payer) `FPxLpgeTVcTXcFM2ugGH5Z7M3GJ39QVDuTCvrJMDAqBL`. Tx is 910 bytes for a 60-byte payload; forwarder overhead ≈ 9.3k CU; receiver ran with 191,366 CU available. |
| S3 | 10:09 | **pass** | `spikes/s3`: the template's write handler registered with `handlerInTee`, does work in the enclave, crosses back with `usingTheDons()`, then calls `SolanaClient.writeReport` on the DON runtime (`@chainlink/cre-sdk` 1.23.0). Devnet tx [`5JfcRJcQ…5QRqn`](https://explorer.solana.com/tx/5JfcRJcQsR2X7Df4Ga4MoFEnM6tiPHSoneoYkGTt8kTUVu49qJ39eDupmwEyWibMsvfLntmoq6X4rgBmVCq5QRqn?cluster=devnet). E15 is unblocked. |
| S4 | 09:55 | **pass** | `spikes/s4`: `tweetnacl` 1.0.3 + `@noble/hashes` 1.8.0 inside a `handlerInTee` handler. sha256("abc") KAT correct, `nacl.box` / `nacl.box.open` round trip with deterministic keys and a sha256-derived nonce correct, tampered ciphertext rejected. Output: `S4 sha256=ba7816bf…15ad shaOk=true boxOk=true tamperRejected=true`. |
| S6 | 11:08 | **pass** | `brizo-infer` itself: real OpenRouter call (`anthropic/claude-haiku-4.5`) from the `handlerInTee` handler with `MODEL_API_KEY` from the environment; answer sealed and delivered. See the brizo-infer table below. |
| S1 | 09:56 | **pass** | `spikes/s1`: `cre.handlerInTee(http.trigger({}), …, [{tee:'nitro', regions:['us-west-2']}])` simulated with `--http-payload ./fixtures/s1.json`; payload decoded with `decodeJson(payload.input)` inside the enclave handler; result returned after `usingTheDons()`. |

Commands (run from each spike's project root):

```bash
SECRET_API_TOKEN=dummy cre workflow simulate conf --target staging-settings --non-interactive --trigger-index 0          # S4
cre workflow simulate conf --target staging-settings --non-interactive --trigger-index 0 --http-payload ./fixtures/s1.json  # S1
```

### brizo-spend (C2) and brizo-settle (E1) on devnet — 14:41–14:43 IST (17:11–17:13 SGT)

The configs were generated from `deploy/devnet.json` (`bun run scripts/apply-devnet-config.ts`), and the payload is lane C's `circuits/build/sample-spend-compressed.json`, copied to `workflows/fixtures/spend.sample-compressed.json`. Run from `workflows/`:

```bash
cre workflow simulate ./brizo-spend --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/spend.sample-compressed.json --limits "$PWD/limits.simulation.json" --broadcast
cre workflow simulate ./brizo-settle --target simulation-settings --non-interactive --trigger-index 0 --broadcast
```

| Time (IST) | Run | Result |
|---|---|---|
| 14:41:29 | spend, no `--broadcast` | Preflight passed (`write reported success without a signature`, as expected for a dry run). |
| 14:41:42 | **spend `--broadcast`** | `{"txStatus":"SUCCESS","txSignature":"19tuaoDA38hgoKo29WXjoJZJn7eA71U3AJySYqG1E93RpFroKGrDSQsSrFqhrzxj7n9BX39EGe64PzPQcMSm8bf"}`. On-chain logs: `Instruction: Report` → `Instruction: OnReport`; brizo_pool consumed **114,392 of 190,100 CU**; forwarder total 124,974 CU; tx 1,141 bytes. |
| 14:41:57 | **same payload replayed** | Refused before landing: `custom program error: 0x1776` = 6006 = **`NullifierUsed`**. After the error-decoding fix (14:42:35): `{"txStatus":"0","error":"NullifierUsed (0x1776)"}`. |
| 14:42:52 | **settle `--broadcast`** | `{"epoch":"2985607","txStatus":"SUCCESS","txSignature":"56y25StBajhcbQRA2MxoGFY6Ayg2rzJLCg9kcpmg9Ga9FaGT1Bbspatzh7bkvgfdr64oLbLHEyTk5Usm42HqwxPR"}`. Operator account `Edk22EeX…` holds 0.05 tUSDC (1 spend × 0.05); vault 9.95. |

### Live end-to-end through the gateway — 17:05–17:17 IST (19:35–19:47 SGT)

Setup: a private devnet RPC (Alchemy) in `workflows/.env` as `SOLANA_DEVNET_RPC_URL`, checked to be devnet by genesis hash `EtWTRABZ…`. An earlier candidate was `solana-rpc.publicnode.com`, which is **mainnet** (`5eykt4Us…`); it was rejected before any use. The gateway (lane C) is started with `gateway/.env` (paths only). All workflows use the prebuilt WASM.

1. Program upgrade. ZAN/Alchemy don't serve the TPU websocket and rate-limit bulk writes, so it was done as a resumable `write-buffer` with `--use-rpc`, then `program upgrade`. The program needed `program extend` by 10,240 bytes first, because the new binary was 1,248 B larger.
2. `npx tsx scripts/make-request.ts --i 4 …`: the request was built from on-chain Leaves and Tree; proof in 338 ms.
3. `POST /api/ask` → `{"requestId":"4ec7643d…","spendTx":"5tUUkGvm…"}` in **14 s**: off-chain snarkjs check, relayer `stage_spend`, then one `brizo-request` simulation (TEE answer → spend finalize → DON-side mailbox POST).
4. `GET /api/answer/4ec7643d…` → `{requestId, ciphertext, nonce, spendTx}`; `nacl.box.open` with the client key gives `{"ok":true,"model":"anthropic/claude-haiku-4.5","finishReason":"stop","answer":…}`. The second read returns `410 {"error":"answer_gone"}`.
5. Replaying the same credit under a new requestId → `stage_refused` (on-chain `NullifierUsed`).

Bug found and patched in lane C's `gateway/scripts/stage-spend.mjs` (left uncommitted for lane C to review). `sendAndConfirmTransaction` waits on a websocket signature subscription that HTTP-only RPCs don't serve, so the stage tx landed but the gateway reported `stage_refused` after about 40 s; seen twice, with pending accounts `GwyyptwW…` and `FcNSUXCa…`. It now sends the raw tx and polls `getSignatureStatuses` over HTTP. The stranded `i=2` stage was finalized directly through `brizo-request` (`2Q49p6fW…`, mailbox correctly refused the unknown ID). The `i=3` stage is still pending (its rent is locked).

### D6 two-phase spend on devnet — 15:20–15:31 IST (17:50–18:01 SGT)

The real-DON-compatible design: the relayer's `stage_spend` verifies the proof; the CRE report is 33 bytes.

| Step | Command | Result |
|---|---|---|
| Program + tests | `anchor build`, `anchor test` (fresh validator) | **16/16 pass**. Stage 119,543 CU (own 400k budget), finalize via forwarder 12,906 CU, settle 14,244 CU. |
| Upgrade (same ID) | `solana program deploy target/deploy/brizo_pool.so --program-id …` | [`25hULWGo…`](https://explorer.solana.com/tx/25hULWGoH8oiFTNcrQ2V8siDUDWBrrQjebN353VnNkfehS4x8iURYsnSfBApURYYPrQc1GKKdjCsvUKkdTjL61s1?cluster=devnet). The Pool layout is unchanged, so the existing pool, deposit and settle state carry over. |
| Real request | `npx tsx scripts/make-request.ts --i 1 --relayer FPxLpgeT…` | Leaves + Tree read over RPC, tree rebuilt, root found in on-chain history, envelope sealed to the enclave key, proof generated and verified in **342 ms**. requestId `1d8e98798c1989721a2248e4383c0f2d`, nullifier `20213039…f33a`. |
| Stage | `node --import tsx scripts/stage-spend.ts …/stage.json` | [`33dQtAxL…`](https://explorer.solana.com/tx/33dQtAxLJRKtMv6MACydfKTUvMfTKePeZdn2gjWmJ7HkUe2tLUUexCWfuTxZKJuzVeLQ2C3HPDBwtvzKAdWujjCy?cluster=devnet), pending PDA `HqnzLTYp…mBKbd` |
| **Finalize via CRE, default limits** | `cre workflow simulate ./brizo-spend --target simulation-settings --non-interactive --trigger-index 0 --http-payload ./fixtures/requests/1d8e…/spend.json --broadcast` | Limits banner: `solana_report=265b solana_cu=300000`. `{"txStatus":"SUCCESS","txSignature":"34LDToSMPhcYfboPdaetufAcPteHGR3AHigPCHUgJZRFpxrAa2991D31X1p28JksgaPu8f1z19jyqpksCBCsmDR6"}` |
| Replay finalize | same command | `{"txStatus":"0","error":"NullifierUsed (0x1776)"}` |
| Replay stage | same stage script | `Error Code: NullifierUsed` |

Not yet done: infer for this request through lane C's real gateway mailbox. The gateway accepts mailbox posts only for IDs that came through its own `/api/ask`, and it still runs the pre-D6 one-phase spend; lane C has to adopt D6 first.

### brizo-infer (C3) — simulation runs

Command, from `workflows/` (mock mailbox `bun run scripts/mock-mailbox.ts` on :8787):

```bash
cre workflow simulate ./brizo-infer --target simulation-settings --non-interactive --trigger-index 0 --http-payload ./fixtures/infer.json
```

| Time | Payload | Result |
|---|---|---|
| 10:15 | valid envelope (`make-infer-fixture.ts`), model key still a placeholder | `{"delivered":true,"status":"model_error"}`. The binding check passed, the envelope opened in the enclave, the sealed error notice reached the mailbox, and the mock mailbox decrypted it with the client key: `{"ok":false,"error":"model_unavailable"}`. The model call itself is waiting on the OpenRouter key (S6). |
| 10:22 | same envelope, last hex digit of `requestBinding` changed (`fixtures/infer.bad-binding.json`) | `{"delivered":false,"status":"bad_binding"}`: refused before decryption and before any model call. |
| 11:08 | valid envelope, real `MODEL_API_KEY` (OpenRouter, `anthropic/claude-haiku-4.5`, max_tokens 1000) | **S6 pass.** `model ok (finish=stop)`, `{"delivered":true,"status":"delivered"}`. The mock mailbox decrypted a branched JSON answer (general / branches on `timeframe` and `ferritinLevel` / caveats). |
| 11:10 | same, second run | `✗ workflow execution failed: [2]Unknown: context deadline exceeded`: the model call exceeded CRE's 10 s HTTP limit, and the thrown error aborted the workflow. Fix: catch it as `model_error` (the sealed notice is still delivered); `maxTokens` 600; prompt asks for < 250 words with no code fences; OpenRouter `provider: { sort: "throughput" }`; strip code fences in the enclave when the content parses as JSON. |
| 11:14 | 3 consecutive runs after the fix | 3/3 `{"delivered":true,"status":"delivered"}`, 11–13 s per run end to end (including WASM compile). 2/3 answers were clean JSON; 1/3 was malformed JSON from the model, passed through as text (the browser shows it as plain text, SPEC §6). |

### Default CRE limits that affect Brizo (`cre workflow limits export`, CLI v1.37.0)

The simulator enforces the production defaults unless `--limits` is given:

| Limit | Default | Impact |
|---|---|---|
| `ChainWrite.Solana.ReportSizeLimit` | 265 B | `BrizoReport::Spend` as specced is 353 B of payload (plus the 32 B account hash in the forwarder report). Too big. |
| `ChainWrite.Solana.GasLimit.Default` | 300,000 CU | SPEC §4.3 plans `computeConfig` ≈ 1,000,000. Over the limit. |
| `HTTPAction.ConnectionTimeout` | 10 s | The model call in the enclave uses `HTTPClient`; a 2,000-token answer may exceed 10 s. |
| `HTTPAction.ResponseSizeLimit` | 250 kb | Fine. |
| `HTTPTrigger.RateLimit` | every 30 s: 1 | Matters only for a deployed workflow. |

Measured in S2/S3 (10:09):

- `writeReport` with `computeConfig: { computeLimit: 400_000 }` fails before sending: `simulation limit exceeded: Solana compute_limit 400000 exceeds maximum of 300000`.
- With `computeLimit: 300_000` the broadcast tx contains **no ComputeBudget instruction**: the forwarder runs with the default 200,000 CU and the receiver gets ≈ 191,000 CU. So in simulation, the receiver's whole Spend path (decompression + Groth16 verify + nullifier insert) must fit in ≈ 190,000 CU.
- 10:16, `brizo-spend` smoke test: the 265-byte limit applies to the **whole signed report**, not just the forwarder report. A 225-byte compressed Spend fails with `Solana chain write report size 370 bytes exceeds limit of 265 bytes` (370 = 109 bytes CRE report metadata + 36 forwarder header + 225 payload). Under the default limit, a Solana report payload can be at most **120 bytes**.
- 10:16, same payload with `--limits "$PWD/limits.simulation.json"` (Solana `ReportSizeLimit` raised to 512b, nothing else changed): passes the size check, reaches the mock forwarder and the template receiver in preflight; the template receiver fails (`ProgramFailedToComplete`), as expected since it can't decode a Spend. The tx fits Solana's size limit.
- Forwarder report bytes = 32 (account hash) + 4 (u32 length) + payload. The S2 tx was 910 bytes with a 60-byte payload and 3 forwarder accounts. An uncompressed Spend (353 bytes) plus 2 more accounts would be ≈ 1,267 bytes, over Solana's 1,232-byte tx limit; compressed (225 bytes) ≈ 1,139 bytes fits.

## Lane B — Solana

Times are IST (machine clock), like lane A's.

### Toolchain (12:50)

- This machine had no Solana CLI, Anchor, Bun, circom or snarkjs (CLAUDE.md's table is for another machine). Installing Agave v2.3.0 (`release.anza.xyz`) and Anchor 0.31.0 (`avm install 0.31.0 --from-source`; the prebuilt download timed out on the venue network).
- Template: `cre-templates@d0223f3` `building-blocks/solana-read-write/solana-read-write-ts/contracts/solana` (cloned to a scratch dir, not committed).

### S5 — groth16-solana + Poseidon with the template pins

| Time | Step | Result |
|---|---|---|
| 13:05 | `cargo check` of `brizo_pool` with the template's exact pins (`anchor-lang =0.31.0`, `solana-program =2.1.21`, …) plus `groth16-solana =0.2.0`, `solana-poseidon =2.1.21`, `bytemuck =1.23.1` | **pass**. `groth16-solana` 0.2.0 resolves to `solana-bn254 2.1.21`, the same as `solana-program`. `solana-program 2.1` no longer re-exports `poseidon`, hence `solana-poseidon`. The template's `borsh` pin is renamed (`borsh-pin`) because the plain name makes `AnchorDeserialize` derives ambiguous. |
| 13:15 | CU estimate for `on_report(Spend)` from Agave syscall costs (`solana-compute-budget` 2.1) | Syscalls: G1 decompress 2×398 + G2 decompress 13,610 + 3 input muls/adds 3×(3,840+334) + pairing 36,364+3×12,121 ≈ **99.7k CU**. The receiver has ≈191k (lane A, S2/S3). Expected to fit with ~50k headroom. To be measured with lane C's proof. |
| 14:05 | `anchor build --no-idl` (Anchor 0.31.0, platform-tools v1.48) + IDL via `RUSTUP_TOOLCHAIN=nightly-2025-04-15 anchor idl build` | **pass**. Workarounds: Anchor 0.31.0's IDL build needs a nightly that still has `proc_macro::SourceFile` (removed in newer nightlies) with the template's `proc-macro2 =1.0.89`, so `anchor-syn`/`anchor-derive-space` are locked at 0.31.0; `zeroize_derive` 1.4.2 and `enum-ordinalize(-derive)` 4.3.x are locked because platform-tools' cargo/rustc can't build the newer ones. |
| 14:10 | `anchor test --skip-build` (localnet, `programs/test_forwarder` CPIs `on_report` signing as `["forwarder", state, receiver]`, like the CRE forwarder) | **12/12 pass. S5 PASS.** Poseidon syscall = circomlibjs (`Poseidon(1,2)`, lane C's zeros and one-leaf root, on-chain root after 2 deposits). Lane C's `sample-spend-compressed.json` verifies on-chain with `circuits/build/verifying_key.rs`. Reused nullifier → `NullifierUsed`; unknown root → `UnknownRoot`; garbage proof → `InvalidProof`; non-forwarder caller → `InvalidForwarderAuthority`. |
| 14:10 | **Compute units (receiver, measured)** | **Spend 112,780 CU** (of 193,514 available after the CPI) — fits the ≈191k that CRE's mock forwarder leaves, ≈78k headroom. Deposit 21,633 CU. Settle 12,798 CU (6,019 with nothing owed). |

### Devnet deployment from the lane A machine — 14:15–14:40 IST (16:45–17:10 SGT)

The original program keypair (`6zTf…`) is only on the first lane B machine, so the program was given a new ID here (`anchor keys sync`, both `Anchor.toml` entries fixed): **`HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC`**. Deploy and admin wallet `FPxLpgeTVcTXcFM2ugGH5Z7M3GJ39QVDuTCvrJMDAqBL`.

| Step | Result |
|---|---|
| Toolchain | Anchor 0.31.0 binary fetched with `curl` (avm's download timed out); `nightly-2025-04-15` installed; platform-tools v1.48 already cached. |
| `anchor build --no-idl` + IDL (pinned nightly) | pass |
| `anchor test` | The first runs failed with `Blockhash not found` on the deposit: a preflight-commitment race on the fresh validator (preflight at `processed`, confirm at `confirmed`). Fix: the test `send` helper passes `preflightCommitment: "confirmed"`. Against a fresh standalone `solana-test-validator`: **12/12 pass**. Spend 114,280 CU, deposit 21,633, settle 14,298. |
| Scripts | `init-devnet.ts` and `deposit.ts` failed on Node 23 with `does not provide an export named 'BN'`. Fix: default-import `@coral-xyz/anchor`. |
| `anchor deploy` (devnet) | [`3WfQPHLX…`](https://explorer.solana.com/tx/3WfQPHLXX38eyV3qcubzJeSTUgNtRQ51Frag1LcnDzh4pqpBNEMGYJnTxnaymizCaU6FtBEXihyAi5rdGJip9fEf?cluster=devnet) |
| `init-devnet.ts` (mock forwarder `7kuEAA3m…`) | [`5vHcT85R…`](https://explorer.solana.com/tx/5vHcT85RhE1cg1ZbdRvii2Kge3UVJEqD8Tb57bK74MzEnQxF1Q9M9o83fqxoJ1uyv37A4Z6XeZV1zy56XXanx78D?cluster=devnet). Addresses in `deploy/devnet.json`; IDL in `deploy/idl/brizo_pool.json`. Faucet (mint) authority `7hh3wK85pFwnZoMvetoSvfPM8krHXkSn4GwbtH3rcFHk`, keypair at `~/.config/brizo/faucet-authority.json` on this machine. |
| `deposit.ts` | [`2W72FdqW…`](https://explorer.solana.com/tx/2W72FdqWyjvh6edud6HHDgV9N3xz2pb7sBCHdAhPX3BdmjByfqQKL682QfDQTrwPqC1duXbsEi3PpTDRuWWZtFay?cluster=devnet): leaf 0, root `076981d9a0de9b5aaf24312eb17ce4592498c2f626d30680c38c87c748ef65b9`, which equals the root in lane C's sample proof. |

## Lane C — ZK + gateway

### 7 Oct 2026, 12:47 SGT — S7 contract probe: blocked

- Worktree/branch checked with `pwd`, `git status --short`,
  `git branch --show-current`, `git log -1 --format='%h %s'`: clean `lane-c`
  at `b496489` before lane C changes.
- Read the required project documents and repo skills in full. Safe `rg --files`
  searches located the skills; no `.env`, signing files, or secret values read.
- Tool checks: `circom --version` → 2.2.3; `snarkjs --version` → 0.7.6
  (prints help, exits 99); `node --version` → default 18.20.8;
  explicit nvm Node → 23.11.1; `bun --version` → 1.4.2.
- Primary references checked: circomlib `circuits/comparators.circom`,
  snarkjs README public Powers of Tau table, groth16-solana README.
  Circom docs fetch returned 502; local compiler used for the actual check.
- Throwaway probe commands in `/private/tmp/brizo-s7-contract-probe`:
  `circom probe.circom --r1cs --wasm --sym -o ...` failed with
  `Non quadratic constraints are not allowed!` at the SPEC binding tautology.
  Subsequent export/witness attempts lacked the compile artifacts; no setup ran.
- After replacing only the binding with a private constrained square in a
  throwaway candidate: `circom candidate.circom --r1cs --wasm --sym -o ...`,
  `snarkjs r1cs export json ...`, Node `generate_witness.js ...`, and
  `snarkjs wtns check ...` succeeded **for the invalid index `i = r - 1`**.
  R1CS inspection confirms the candidate binding wire is used in constraints.
- Durable reproduction: `circuits/spikes/check-spec.mjs` and
  `circuits/spikes/spec-probe.circom`; invocation and findings in `HANDOFF-C.md`.
  Explicit Node 23 invocation exited 0: confirmed both SPEC failures; candidate
  private square retained the binding; 8-bit index candidate accepted 0 and 199
  and rejected 200, 256, and `r - 1`. These are diagnostic candidates only.
- S7 is **not passed**. Stopped before production circuit/setup/key generation,
  per the user's rule to stop when the shared SPEC needs changing. Proposed
  8-bit index constraint, private binding square, decoded-byte hash encoding,
  and encrypt-before-prove sequencing sent to the user for coordination.
- Signatures: none; no transactions or deployments attempted.

### 7 Oct 2026, 12:56 SGT — S7 PASS after user approval

- User approved `Num2Bits(8)`, private binding square, and decoded-byte hash
  formula. Shared `SPEC.md` untouched; approved contract in `HANDOFF-C.md`.
- `npm install --ignore-scripts --no-audit --no-fund`: pinned circomlib 2.0.5,
  circomlibjs 0.1.7, snarkjs 0.7.6. Sandbox DNS failed initially; approved network
  download succeeded. No deployment or signing action.
- `curl --fail --location --max-time 90 https://circom.info/powersOfTau28_hez_final_12.ptau -o build/powersOfTau28_hez_final_12.ptau`:
  fetched public power 12. `shasum -a 512` gave SHA-512 `15006dff...f8ffee`;
  Python BLAKE2b comparison matched the full published snarkjs README hash
  `ded26941...8a4a`. Both full hashes in `build/setup-provenance.json`.
- Test-first: Node credit witness test failed before compilation; proof fixture
  and protocol tests failed before implementation. Witness checks cover 0/199
  accepted, 200/256/r−1 refused, altered root/secret/nullifier/path refused.
- `node scripts/compile.mjs`: default O1 made 6,256 constraints and setup printed
  `circuit too big` for power 12. Set `--O2`: 2,927 constraints, three public
  inputs, 23 private inputs, zero public outputs. Depth remains 10.
- `snarkjs groth16 setup build/credit.r1cs build/powersOfTau28_hez_final_12.ptau build/credit_0000.zkey`:
  succeeded on O2. `node scripts/contribute.mjs`: one local contribution with
  entropy generated privately in-process. Public hash in setup provenance.
- `snarkjs zkey export verificationkey build/credit_final.zkey build/verification_key.json`;
  `snarkjs zkey verify build/credit.r1cs build/powersOfTau28_hez_final_12.ptau build/credit_final.zkey`:
  **ZKey Ok!**; full circuit/contribution hashes in prior terminal output and
  public setup metadata. Currently single-party phase 2.
- `node scripts/prove.mjs` on Node 23.11.1: **409 ms**, verified true, under 5 s.
  Exported browser wasm/zkey, proof/public inputs, converted Spend fixture,
  Rust key, Poseidon vectors, binding vector and timing metadata.
- `node --test test/*.test.mjs`: **4 pass, 0 fail**, including independent
  mutation of root/nullifier/binding. Snarkjs worker cleanup added to the test
  through ffjavascript's public terminate API so the runner exits normally.
- Fetched/read official groth16-solana v0.2.0 `parse_vk_to_rust.js` into `/private/tmp`,
  executed with public verification key only. Compared generated Rust exports:
  identical modulo whitespace/comments/trailing commas. Initial formatting
  comparison missed trailing commas; normalized comparison passed.
- `NO_DNA=1 cargo run --manifest-path rust-check/Cargo.toml`: built pinned
  groth16-solana 0.2.0; converted proof **verified**, all three changed public
  inputs **rejected**. This is native host validation, not on-chain S5 evidence.
- Artifact SHA-256 from `shasum -a 256 build/credit.wasm build/credit_final.zkey build/verification_key.json build/verifying_key.rs`
  recorded in `HANDOFF-C.md`. Lane B can consume the exports now.
- Signatures: none; no transactions, deployments or secret-file reads.

### 7 Oct 2026, 13:00 SGT — lane A shared-contract integration hold

- Read `/Users/sohamvijay/Desktop/brizo-A/docs/HANDOFF-A.md`, public
  workflow package/config key, `brizo-infer/main.ts`, and `lib/brizo.ts`.
  No secret files or fixture client keys read.
- Lane A requires compressed 32/64/32 proof points and
  `--limits workflows/limits.simulation.json`, config-owned mailbox destination,
  and `sha256(requestIdBytes || clientPubBytes || "answer")[0..24]` answer nonce.
  These differ from shared SPEC. Asked user approval before implementing the
  new wire contract; no gateway code or compressed exports produced yet.
- `cre workflow simulate --help`: installed CLI confirms `--limits`,
  `--http-payload`, `--broadcast`, `--target`, `--trigger-index`, and
  `--non-interactive`. No workflow simulated during this check.
- `spl-token create-account --help`, `spl-token mint --help`,
  `NO_DNA=1 solana transfer --help`: checked installed CLI syntax for future
  opaque signer consumption. No signing files read or transactions sent.
- Inspected installed groth16-solana 0.2.0 decompression and solana-bn254 2.2.2
  native compression source to plan compatible conversion once approved.
- Lane B and D worktree paths do not exist yet; devnet addresses unavailable.
- S7 commit: `7251511`. Initial blocker diagnostic commit: `4622759`.
  Both commit messages contain no co-author trailers.

### 7 Oct 2026, 15:22 SGT — user-requested lane A context import

- `git log`, `git worktree list`, branch/status/diff inspection confirmed main
  `141b61d` already contains A through `9891987`; lane A was clean. Read current
  A handoff/evidence, public config/key, Spend/Settle/Infer implementation,
  Solana/report library and config-generation script. No secret files read.
- `git merge --no-ff --no-commit main`: clean automatic merge; EVIDENCE includes
  both A and C sections; no unresolved conflicts and no circuit changes.
- Locked `bun install --frozen-lockfile --ignore-scripts --cache-dir /private/tmp/brizo-c-bun-cache`
  stalled. A typecheck attempted before dependencies were ready reported missing
  `tsc`; canceled download (exit 130), retained its partial install in a fresh
  `/private/tmp/brizo-c-partial-deps-*` directory and linked A's already installed
  packages inside an ignored node_modules directory. An initial top-level
  symlink did not match the directory-only ignore rule; replaced it with a
  directory containing package symlinks, then rechecked types/tests. No A files modified.
- On merged workflow sources: `bun run typecheck` **passed**; `bun test lib`
  **5 pass, 0 fail**; direct comparison to C's approved binding test vector
  **matched**. Commands use Bun 1.4.2; no simulation or signing involved.
- On preserved circuit sources: Node 23 `node --test test/*.test.mjs`
  **4 pass, 0 fail**; `NO_DNA=1 cargo run --locked --offline --manifest-path rust-check/Cargo.toml`
  converted proof verified and all changed public inputs rejected.
- Checked latest infer config: maxTokens 600, sealed error notice on model
  timeout; public key already published by A. `deploy/devnet.json` still absent.
- C adoption of compressed points/report limit/config mailbox/answer nonce is
  still awaiting user approval under the shared-SPEC rule. No new secret needed
  for code implementation. Live integration needs B's addresses and opaque
  funded faucet/mint-authority signer provisioning later.
- Signatures: none newly generated in this turn; imported A's recorded evidence.

### 7 Oct 2026, 15:48 SGT — approved D1–D4 compression

- User explicitly approved HANDOFF-A's D1–D4 contract. Shared SPEC was not edited.
- Added `proofToSolanaCompressed`: negate A once, then Arkworks/Solana compressed
  G1/G2 format, big-endian with sign flag. Added native `solana-bn254 =2.2.2`
  compression to the Rust host check and exported `sample-spend-compressed.json`.
- TDD: the compression test first failed with the implementation stub, then
  passed against the independently native-compressed full payload.
- `Node 23 node --test test/*.test.mjs`: **5 pass, 0 fail**.
- `NO_DNA=1 cargo run --locked --offline --manifest-path rust-check/Cargo.toml`:
  original proof verifies, compressed/decompressed proof verifies, each of
  three independently modified public inputs is refused. `cargo test --offline`
  also passed the host target. Verification/proving keys remain unchanged.
- Public upstream sources: Arkworks installed serialization code and
  groth16-solana 0.2.0 decompression API. No network or chain write in these checks.
- Signatures: none. The public compressed fixture is for synthetic S5 parity,
  not a funded deposit or an end-to-end infer envelope.

### 7 Oct 2026, 15:52 SGT — gateway P0 implementation and local verification

- Public package checks: `npm view hono version` returned 4.13.13;
  `npm view @solana/spl-token version` returned 0.4.15. Gateway pins Hono 4.13.13,
  web3.js 1.98.4, zod 3.25.76. Faucet uses installed Solana/SPL CLIs rather
  than another token library. `npm install --ignore-scripts --no-audit --no-fund
  --cache /private/tmp/brizo-c-npm-cache` (Node 23 PATH) installed 64 packages.
  Upstream uuid deprecation warning came through web3.js; no install scripts ran.
- Read the public A handoff, infer config/key, config helper, protocol library,
  and local CLI `spl-token mint --help`, `spl-token create-account --help`,
  `solana transfer --help`. `git worktree list` / `git log main` confirmed no
  B worktree/deployment or D app available yet. No .env or signing file read.
- TDD: app's six initial cases and CRE's two initial cases failed against stubs,
  then passed. Faucet's two cases failed against its stub, then passed. Added
  real snarkjs verifier test, deployment whitelist test, D1–D4 payload/nonce
  and early-poll test, plus body/origin/readiness checks.
- `bun test`: **14 pass, 0 fail**, 88 assertions; `bun run typecheck`: **passed**.
  Hono and persistent SQLite are real. The verifier launches real Node/snarkjs
  on the S7 proof; valid proof accepted, modified binding refused. External
  signing and CRE execution are isolated test doubles, not chain evidence.
- During testing, a CLI fixture process exceeded its 2 s timeout when the full
  suite was busy. Isolated rerun passed; changed the test process timeout to
  10 s (production CRE timeout remains 120 s) and corrected its workflow flag
  assertions to inspect argv[2]. Full suite then passed. A Hono union typing
  error was resolved by using the same bindings type on both listeners.
- Initial local server binds on 8787 and smoke 18787 failed with EADDRINUSE
  inside the sandbox; `lsof -nP -iTCP:8787 -sTCP:LISTEN` found no listener.
  Retried loopback smoke with sandbox escalation; it started successfully on
  public 18788/private 18787, using only a generated public-config fixture.
  No A process was stopped and no A config was edited.
- HTTP smoke: `WORKFLOWS_DIR=.runtime/smoke-workflows PORT=18788 MAILBOX_PORT=18787
  bun run src/server.ts`; Bun fetch checked config 200, wasm/zkey/VK downloads
  200, public mailbox 404, unsolicited private mailbox 404. Download hashes:
  wasm `987dbaffe2205254257c6515c623b512312f4414052c9c6beb9b17958993b0dc`;
  zkey `3936dc2486884d764d234842a278fb4a5e36f29daba1ec9866aaea220e6bb8a3`;
  VK `14b5f1ca74a45d24f479d95fa0785609a6a1b6dea5d4facb3712c3824823ac6c`.
  Test server stopped with SIGINT, exit 0. Config readiness correctly false
  without B's deployment; no funded request was submitted.
- Found A's config helper fallback Token program address is invalid (web3.js
  public-key decoder rejects it). Verified correct address against primary
  https://solana.com/docs/payments/how-payments-work and recorded the explicit
  `tokenProgram` requirement in HANDOFF-C. Only C code changed.
- Gateway implements rate limits, strict byte encoding, bounded shared queue,
  private callback/state/nonce validation, one-use IDs and answers, 15-minute
  expiry, subprocess timeout/process-group cleanup and body-free diagnostics.
  Temporary CLI payloads hold sealed data only and are removed in finally.
- Independent requesting-code-review review reproduced a paid-credit bug:
  a long queue could pass pre-spend checks, then expire before its Infer
  callback. Receiving-code-review workflow: added a failing regression (502
  after successful spend), then separated queue deadline from answer retention.
  Active simulations use subprocess deadlines; callback starts a fresh 15-min
  answer lifetime. Shared sweeper and request handlers use the same expiry rule.
  Regression passed; reviewer independently reran 9 app tests, all passing,
  and reported no remaining important findings.
- Final verification (15:56 SGT): `bun --no-env-file --no-install test` and
  `bun --no-env-file --no-install run typecheck` passed; 15 tests, 0 failures.
  Node 23 circuit suite: 5 pass, 0 fail; native Rust compressed proof verification
  and rejection of changed inputs passed again. `git diff --check`: passed.
  No-env-file testing avoids reading a user-created .env during verification.
- Signatures: none newly generated. Faucet + live Spend/Infer validation still
  requires B's public deployment and user-provisioned opaque signing paths.
  E4/E7 and P2 remain gated on P0 end-to-end/checkpoint per PLAN.
- Commit commands: explicit `git add --` for C's circuit source/fixture paths,
  then `git commit -m "feat(circuits): export approved compressed Spend fixtures"`
  produced `5d9d92f`. Explicit staging of gateway source/config/example/tests
  and C's handoff/evidence, followed by
  `git commit -m "feat(gateway): implement approved CRE spend and infer pipeline"`.
  No whole-repository staging, secret files or co-author trailers.

### 7 Oct 2026, 16:09 SGT — user-requested main integration

- User requested merging/pushing lane C into main so other lanes can consume it.
  `git status`, history/worktree/remotes, staged diff and changed-file list checked.
  Main's unrelated modified SPEC and untracked brief/handbook/pitch files were
  preserved; no broad staging or stash. SPEC SHA-256 before/after merge:
  `a87c9fbc795be34d6c4dd013718ac419db46f5ff79be845e8d0a970a21613592`.
- `git ls-remote --heads origin main` confirmed the initial remote tip `705ee2a`.
  Main also received A's `6afefff` merge, including `5f19f85` Token address fix,
  before C integration completed. Updated C handoff to mark that fix resolved.
- `git merge --no-ff --no-commit lane-c`: clean automatic merge. Circuit/gateway
  files match lane-c exactly; index check passed. Reused only public installed
  dependencies via symlinks inside ignored main node_modules directories.
- Merged gateway: `bun --no-env-file --no-install test` **15 pass, 0 fail**;
  `bun --no-env-file --no-install run typecheck` passed. Fresh main witness test
  initially lacked ignored generated compiler helpers; `Node 23 node
  scripts/compile.mjs` rebuilt them with the same 2,927 constraints and unchanged
  committed wasm. Then `node --test test/*.test.mjs` **5 pass, 0 fail**.
- Merged native verification: `CARGO_TARGET_DIR=/Users/sohamvijay/Desktop/brizo-C/circuits/rust-check/target
  NO_DNA=1 cargo run --locked --offline --manifest-path rust-check/Cargo.toml`
  verified converted/compressed/decompressed proof and rejected all changed
  public inputs. Reused only the compilation cache; fixture stayed unchanged.
- Integration commands: explicitly stage only C handoff/evidence updates,
  `git commit -m "Merge lane-c: ZK artifacts and CRE gateway"`, then
  `git push origin main` (no force). Keep lane-c/worktree for unfinished P0/P1/P2.
- No .env, signing file or secret value read/staged; no co-author trailer.
  No deployment or transaction; live P0 still needs B's devnet deployment.

### 7 Oct 2026, 18:44 SGT — D6 gateway integration

- User confirmed B's D6 upgrade on devnet and explicitly requested the new
  two-phase gateway sequence. `git merge --ff-only lane-a` imported committed
  public A/B context through `29d9b31`; no other lane's implementation was
  manually edited. Read `scripts/stage-spend.ts`, the deployed stage IDL,
  HANDOFF-A §1/D6, and `workflows/scripts/make-request.ts` in full.
- After binding/snarkjs checks, one serialized request stages the compressed
  proof (unchanged A32/B64/C32) with **400,000 CU**, waits for confirmed success,
  then finalizes via CRE payload `{requestId,nullifierHash,relayer}` with
  `--broadcast` and **without `--limits`**. Infer remains gated on matching
  request ID, `SUCCESS`, and a valid transaction signature. Updated readiness
  checks for the D6 config, which has no tree field/custom limits file.
- Added pinned Anchor 0.31.1 (matching B's reference) with
  `npm install --ignore-scripts --save-exact @coral-xyz/anchor@0.31.1`.
  Shell npm ran under Node 18 and reported upstream engine/audit warnings;
  executable verification below used Bun 1.4.2 and Node 23. No install scripts ran.
- Added `RELAYER_KEYPAIR` placeholder to `.env.example`. An isolated signing
  CLI alone consumes that local signing file. Its environment is restricted to
  PATH/HOME/the opaque signer path, without model/enclave credentials; output
  contains only public stage metadata. No agent access to `.env`, signing files
  or private fixture contents. Actual `.env` remains for the person to fill.
- TDD: 4 new route/CRE regressions failed on the old one-phase implementation;
  stage adapter/IDL tests failed against stubs before implementation. Then
  `bun --no-env-file --no-install test`: **22 pass, 0 fail**, including real
  snarkjs verification and deployed-IDL encoding; `bun --no-env-file --no-install
  run typecheck` passed. External signing/CRE boundaries are test doubles.
- Node 23 imported the real signing CLI's public instruction builder and
  encoded **232 bytes** with two instructions and expected sample pending PDA
  `ArTuf56LcZcLsgTMb6N4GgrwMNLU6ULxBay3piiGdU4W`. No transaction submitted.
- In-memory old-schema SQLite migration preserved an existing reserved ID and
  added `stage_tx`. Pending/failed status exposes confirmed `stageTx`; normal
  success responses are unchanged. No automatic retry after stage/finalize
  timeout/restart; an unfinalized stage may retain its rent until manual finalize.
- Local startup initially hit the sandbox loopback listen restriction reported
  as EADDRINUSE. Automatic approval review timed out on the first runtime-start
  request. A safer retry disabled `.env` loading and signing paths; startup
  succeeded. The first sandboxed HTTP probe hit EPERM; one bounded permitted
  Node 23 process then started/stopped the server and verified the deployed
  program ID, wasm SHA-256, unconfigured Ask **503**, and public mailbox **404**.
  Live acceptance still requires local funded relayer provisioning.
- Independent review found restart after a queue deadline could immediately
  expire a failed staged request and hide its diagnostics. Added a fresh
  15-minute TTL to interrupted jobs and a red/green regression verifying
  `gateway_restarted` plus the retained stage signature, then expiry after TTL.
- The earlier unfinished smoke-driver scaffold and its package state were
  preserved under ignored `gateway/.runtime/pending-smoke/`, outside the D6 patch.
  No fabricated live metrics or new C signatures; no deployment/mainnet action.

### D6 publication to main

- Lane C commit: `df36a61` — `feat(gateway): stage D6 spend before CRE finalization`.
  Independent review confirmed the restart diagnostic correction; no remaining
  Critical/Important D6 findings. No co-author trailer in the C commit.
- `git ls-remote --heads origin main` showed A/B's public tip `29d9b31` already
  pushed. Local main was behind at `b1e53a1`; `git merge --no-ff --no-commit lane-c`
  automatically incorporated it and C's D6 patch. Gateway/circuit index parity
  with lane-c passed. The C diff's whitespace check passed; A's imported
  project.yaml EOF blank-line warning was preserved under lane ownership.
- Main gateway: `bun --no-env-file --no-install test` **22 pass, 0 fail**;
  `bun --no-env-file --no-install run typecheck` passed. Main workflow encoding:
  `bun --no-env-file --no-install test lib/brizo.test.ts` **5 pass, 0 fail**;
  workflow `typecheck` passed. Reused C's installed public Anchor package through
  an ignored node_modules symlink; a fresh checkout uses the gateway lockfile.
- Main's unrelated SPEC modification, brief/handbook and pitch files remain
  unstaged and untouched. SPEC SHA-256 is still
  `a87c9fbc795be34d6c4dd013718ac419db46f5ff79be845e8d0a970a21613592`.
- Publication commands: explicitly stage this Lane C evidence update,
  `git commit -m "Merge lane-c: D6 two-phase gateway"`, then `git push origin main`
  without force. No real `.env`, signing file, deployment or transaction involved.

### 7 Oct 2026, 19:30 SGT — binding-aware D6 and combined Request

- User explicitly requested the new staged binding check and A's preferred
  E15 `brizo-request`. `git merge --ff-only main` brought C's earlier local
  publication into lane-c; `git fetch origin main` and `git merge --no-edit
  origin/main` imported A/B through `fa98900` as merge `35e3fee`. Earlier push
  of local main `4f0f751` was rejected as non-fast-forward because A/B advanced
  origin; that earlier D6 publication was not yet remote. No force push used.
- Read updated public HANDOFF-A §1/D6/E15, Request source/config, infer helper,
  build script and deployed IDL. Gateway now runs confirmed staging followed
  by one combined seven-field Request simulation with `--broadcast --wasm`;
  no separate Spend/Infer simulations and no `--limits`. Same binding goes to
  staging and the Request. Callback stays unreadable until payment result is
  accepted; failed paid delivery preserves its public transaction signature.
- Checked CRE 1.37.0 `workflow build --help` and `workflow simulate --help` for
  the build output and `--wasm` flags. Readiness validates the prebuilt WASM
  header as well as matching public Request/deployment addresses.
- Node 23 staging consumes A's private RPC environment through
  `--env-file-if-exists=<WORKFLOWS_DIR>/.env`; the agent/application do not open
  the file. Signing CLI removes unrelated credentials and checks the devnet
  genesis prefix before reading the signer. Prefix checked against
  [Solana's official network references](https://solana.com/docs/payments/agentic-payments/x402#solana-networks-and-assets).
  Tests check devnet acceptance, other-network refusal and opaque env-file args.
- TDD regressions failed on the old two-simulation path before implementation.
  Latest `bun --no-env-file --no-install test`: **26 pass, 0 fail**, 149 assertions;
  `bun --no-env-file --no-install run typecheck` passed. Tests include refused
  payment after an early callback, paid delivery failures, exact payload/CLI
  flags, missing WASM, queue serialization and restart diagnostics. Real
  snarkjs and IDL encoding run; signing/CRE boundaries remain test doubles.
- Ran `bash scripts/build-wasm.sh` from A's workflow directory under Node 23.
  Initial sandboxed compilation exited 1; the permitted compile-only retry
  succeeded (exit 0). Raw build output was suppressed. Only ignored public
  WASM artifacts were created; no A source changed. SHA-256 outputs:
  - `brizo-spend.wasm`: `3d94983a3c4494079db8bdfb061095d92a87569d41858da7037fbc71b501c2b5`
  - `brizo-infer.wasm`: `5c1a8234e96c190a8b5f7bfa73563ce04e7c36c4db30be7c246733c0bb0a70c0`
  - `brizo-settle.wasm`: `2d1d88161583c432e9ea18090dc50a121a03dbda5170f594f1b8fec7dc0485ea`
  - `brizo-request.wasm`: `34e5271d3d77dec97502c0c8d02471997d34aaee154d09ab455fc7c867c59d74`
- User confirmed the relayer path is configured locally and explicitly said
  **do not run live CRE until private-RPC confirmation**. No live stage, CRE
  simulation, deployment/mainnet action or new C signature in this update.
  At 19:30 SGT no P2 work was started; it remains deferred behind P0/P1.
- Independent review identified a combined-workflow recovery regression: a
  mailbox exception can occur after payment but before the final JSON result.
  A already logs the public SUCCESS signature before posting. Two new tests
  reproduced lost signatures, then a bounded stdout observer now persists only
  the matching request's validated public signature before command failure.
  Chunk-split lines, wrong IDs, invalid/duplicate signatures, nonzero exit,
  timeout and callback-before-restart cases pass. Observation never changes
  answer authorization. Final local suite: **28 pass, 0 fail**, 160 assertions;
  TypeScript passes. Unknown outcomes before the payment log still need manual
  on-chain inspection; no automatic retries were added.
- Imported workflow validation: `bun --no-env-file --no-install test
  lib/brizo.test.ts` **5 pass**, including the 65-byte binding-aware Spend
  encoding; workflow `typecheck` passed. Final `git diff --check` is clean.
  Refetched origin/main before publication; public tip remained `fa98900`.
  Reviewer reran the in-memory app/config tests independently: 17 pass.

### Combined Request publication to main

- Independent final review: no Critical/Important findings remain; payment-log
  recovery fix confirmed. Review established local behavior only, not live CRE.
- Explicitly staged only C's gateway and authorized handoff/evidence files.
  `git commit -m "feat(gateway): finalize bound spends with one CRE request"`
  created **`30335737ea418e4d1691579ea8388c040fd5eceb`** on lane-c. Commit and
  the preceding context-import merge have no co-author trailers.
- In the main worktree, `git merge --ff-only lane-c` succeeded. Only committed
  upstream A/B work was imported alongside C; no other lane source was manually
  changed. Main gateway: **28 pass, 0 fail**, TypeScript passes. Main workflow
  encoding: **5 pass, 0 fail**, TypeScript passes. All checks used
  `bun --no-env-file --no-install` and Node 23 on PATH.
- `git push origin main` succeeded from `fa98900` to `3033573`;
  `git ls-remote --heads origin main` independently returned the full SHA above.
  C's earlier `df36a61` and all current runtime changes are now on shared main.
- Main's unrelated SPEC modification, brief/handbook and pitch remain untouched.
  SPEC SHA-256 remains
  `a87c9fbc795be34d6c4dd013718ac419db46f5ff79be845e8d0a970a21613592`.
  No environment/signing file was staged; no live transaction or simulation.

### 7 Oct 2026, 17:38 IST (20:08 SGT) — HTTP stage confirmation and private-RPC faucet

- User supplied an uncommitted `gateway/scripts/stage-spend.mjs` patch and
  reported stages landing while `sendAndConfirmTransaction` waited on an
  unavailable RPC WebSocket. Explicit request: review/commit/push, surface
  program error names, and use the private workflow RPC for the faucet.
  Retained the user's raw-send/signing/blockhash changes, kept preflight enabled,
  removed the unused WebSocket confirmation import and extracted HTTP polling.
- Checked pinned web3.js 1.98.4 source (`connection.ts`, `errors.ts`) and official
  [sendTransaction](https://solana.com/docs/rpc/http/sendtransaction) /
  [getSignatureStatuses](https://solana.com/docs/rpc/http/getsignaturestatuses)
  references. Polling searches history, requires confirmed/finalized, rejects
  failed status, and only declares blockhash expiry when the transaction remains
  unknown. Processed transactions continue waiting within the worker deadline.
- Stage failures now return structured fixed/IDL error codes. Mapping accepts
  custom errors only on instruction index 1 (the Brizo instruction, after CU),
  including web3.js preflight's public `transactionError` message. Adapter
  allowlists deployed IDL names; `NullifierUsed` reaches the API without raw
  diagnostics, program logs, RPC URLs or any environment/signing values.
- Added isolated `gateway/scripts/faucet.ts`. Bun's explicit `--env-file` loads
  the existing workflow RPC opaquely; no agent/application opens the real file.
  Child drops enclave/model credentials, verifies devnet genesis, and uses the
  configured RPC for mint/ATA reads and every funding CLI `--url`. Production
  refuses missing RPC configuration; public config/results retain no private URL.
  Amounts, signer ownership validation and wallet-attempt limit are unchanged.
- Tests first reproduced hardcoded `--url devnet` and the lost stage error name.
  Added HTTP polling/error cases, sanitized CLI result validation, exact private
  RPC arguments, and actual Bun environment loading using a **synthetic**
  `rpc.fixture` containing only placeholders. Verified credentials are removed
  and missing RPC refuses; no real .env/keypair/private client fixture was read.
  A bounded public-argument probe established Bun removes an argv `--` separator;
  corrected the fake-CLI harness. Ran `bun --help` to verify env-file flags.
- Independent review reproduced an orphan signing-process risk: outer faucet
  deadline killed Bun but detached nested commands could continue. Added
  `runCommand`'s `detached:false` option for inner faucet commands; outer worker
  group cleanup now includes them. A synthetic process-tree regression failed
  before the fix and passes after; reviewer independently reproduced child gone
  after outer timeout. Test processes are always cleaned up.
- Final `bun --no-env-file --no-install test`: **35 pass, 0 fail**, 197 assertions;
  `bun --no-env-file --no-install run typecheck` passed under Node 23/Bun 1.4.2.
  Script TypeScript is now included in typecheck. Reviewer independently ran
  selected pure tests (**8 pass**) and TypeScript; no remaining important findings.
  `git diff --check` is clean. No new live signing/CRE/deploy/mainnet action;
  user-reported landed stages are not claimed as newly verified lane C evidence.
- `git fetch origin main` received shared tip `bb2fa78`, descended from our
  published `d989e12`, with A/D live evidence and frontend setup updates. A's
  Request now reports paid mailbox refusal as `answered`. Extended the delivery
  regression: it initially lost `spendTx` and mislabeled this as spend refusal.
  C now preserves that paid receipt and returns `inference_failed`, including
  when an inconsistent result says delivered=true; no ciphertext is released.
  Added API-level `NullifierUsed` propagation/no-CRE verification.
- Lane C commit **`8b19838`**: `fix(gateway): confirm stages over HTTP and use
  private faucet RPC` (no co-author trailer). During integration, shared origin
  advanced again; the actual merge input was **`1425702`**, which includes the
  earlier `bb2fa78` updates. One conflict in C-owned `gateway/src/server.ts`:
  preserved the incoming `RELAYER_KEYPAIR_PATH` compatibility alias and C's
  isolated private-RPC faucet. No other lane file was manually edited.
- After conflict resolution, gateway TypeScript passes and full tests pass:
  **35 tests, 198 assertions**. The callback-present `answered:true` case also
  refuses delivery while retaining the receipt. Imported workflow encoding
  tests: **5 pass**, TypeScript passes. All used `--no-env-file --no-install`.
  Independent review verified the new callback case and no-CRE named refusal.
- Main `git merge --ff-only lane-c` succeeded. Main gateway verification passed:
  **35 tests / 198 assertions**, TypeScript passes. C/main gateway/circuit source
  parity passed. Main's unrelated local docs/SPEC.md, brief, handbook and pitch
  were preserved; SPEC SHA-256 remains
  `a87c9fbc795be34d6c4dd013718ac419db46f5ff79be845e8d0a970a21613592`.
- Initial `git push origin main` was rejected because shared main advanced.
  Refetched **`7970723`**; its file tree matched the tested `1425702` update
  exactly. Merged that frozen SHA into lane-c; `git diff --exit-code 11af123
  HEAD` confirmed no file changes. Then `git push origin HEAD:main` succeeded
  from `7970723` to **`de3b2f09e41c17b98903bc0fa18dd82157414f03`**.
  `git ls-remote --heads origin main` independently returned that full SHA.
  All publication pushes were non-force; C's commits have no co-author trailers.

### 7 Oct 2026, 17:58 IST (20:28 SGT) — requested history rewrite and gateway verification

- User explicitly requested removal of every `xipharis` commit from remote
  history and a force push. Remote advertised only main, at `b05cf3a`.
  Identified exactly three matching author/committer commits: `988a55e`,
  `3598904`, `a77630f` (frontend, revert, reapply). Abhivansh's separate
  `dea038f` frontend commit has the same tree as the reapply and is retained.
- Created and verified a local Git bundle backup under the common Git directory.
  Reparented descendants while preserving each retained commit's tree, author,
  committer and message. Reachable history changed from 82 to 79 commits;
  no other commits were dropped. `git diff --exit-code b05cf3a 377017a` passed,
  and author/committer scans found no `xipharis` in the rewritten history.
- Fresh gateway checks under Node 23/Bun 1.4.2:
  `bun --no-env-file --no-install test`: **35 pass, 0 fail, 198 assertions**;
  `bun --no-env-file --no-install run typecheck`: passed.
- Executed `git push
  --force-with-lease=refs/heads/main:b05cf3ad4e577390f6b15fbf6e4e2ba0c4dcfa06
  origin 377017a4d8553e8e63de2093c9125de203317280:refs/heads/main`.
  Push succeeded; an independent `git ls-remote --heads origin main` verified
  **`377017a4d8553e8e63de2093c9125de203317280`**. GitHub reported the configured
  URL redirects to `https://github.com/akronim26/brizo-old.git`.
- Atomically aligned local main/lane-c and the two affected A/B branch references
  using compare-and-swap updates and verified identical trees before every update.
  Other lane files, dirty main SPEC, brief, handbook and pitch remain untouched.
  `git log --all --author=xipharis --regexp-ignore-case` returns no commits.
- User now confirms the private workflow devnet RPC is configured and reports
  the full gateway flow succeeded in 14 seconds (public spend signature recorded
  in lane A's live evidence). This resolves the prior live-RPC confirmation hold.
  No new live funding/stage/CRE transaction, deploy or mainnet action was run by C.
  Shared-note indices 0–4 are used or staged; any fresh proof must use i >= 5.
  Optional duplicate-pending recovery and unfinished E4/E7/P2 remain deferred.

## Lane D — App
