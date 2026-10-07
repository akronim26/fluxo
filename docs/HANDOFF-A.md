# Lane A handoff (CRE)

Status: 7 Oct 2026, 10:25. Lane A owns this file.

## For lane C: how the gateway drives the workflows

### One-time setup on the gateway host

- **Tools:** CRE CLI v1.37.0 and `cre login` (done by a person). **Bun ≥ 1.2.21**: Bun 1.2.16 breaks every TS workflow with `wasm trap: unreachable`.
- **Install:**
  ```bash
  cd workflows && bun install
  ```
- **`workflows/.env`** (see `workflows/.env.example`; the file holds names and paths only, never commit it):
  - `CRE_SOLANA_PRIVATE_KEY` — path to a funded devnet keypair. It pays fees for `--broadcast`.
  - `CRE_ETH_PRIVATE_KEY` — the placeholder from `.env.example`.
  - `SECRET_MODEL_API_KEY` — the OpenRouter key.
  - `SECRET_ENCLAVE_BOX_SK` — written by `bun run scripts/gen-enclave-key.ts`.
- **Enclave public key** (what the browser encrypts to): `workflows/enclave-public-key.json` → `enclaveBoxPublicKey`. It is base64, 32 bytes. Current key: `yGXMouHzxRWeSdtpGtaQ7Y5O673c91NaXg2nkD+kkmg=`. If the gateway runs on another machine, that machine needs the matching `SECRET_ENCLAVE_BOX_SK`; copy it by hand, never through git.
- **Spend and settle configs:** after lane B writes `deploy/devnet.json`, run:
  ```bash
  bun run scripts/apply-devnet-config.ts
  ```
  It writes `brizo-spend/config.simulation.json` and `brizo-settle/config.simulation.json`.
- **Mailbox:** `brizo-infer/config.simulation.json` → `mailboxBaseUrl` (default `http://localhost:8787`). Set it to the gateway's own address.

All commands run from `workflows/` (the CRE project root). Run one simulation at a time.

### 1. Spend = stage (relayer tx) + finalize (CRE brizo-spend) — D6, since 18:00 SGT

**1a. Stage (gateway relayer, direct Solana tx).** After the off-chain snarkjs pre-check, the gateway sends `brizo_pool.stage_spend(root, nullifier_hash, request_binding, proof_a, proof_b, proof_c)`:
- the args are the compressed hex fields lane C already produces (D1 conversion);
- accounts are `relayer (signer, w), pool, tree, nullifiers, pending (w) = PDA ["pending", pool, nullifier_hash], system_program`;
- prepend `ComputeBudgetProgram.setComputeUnitLimit(400_000)` (the verify costs ≈ 120k CU);
- the relayer pays about 0.0019 SOL rent for `pending` and gets it back at finalize;
- reference implementation: `scripts/stage-spend.ts`. Failures surface as Anchor errors: `UnknownRoot`, `InvalidProof`, `NullifierUsed`, `OverSpent`, or "already in use" when it's already staged.

**1b. Finalize (CRE).** Only after stage succeeded:

```bash
cre workflow simulate ./brizo-spend --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/<requestId>-spend.json --broadcast
```

**No `--limits` any more.** The Spend report is 65 B (210 B signed), so it fits CRE's default 265 B limit, the same limit a real DON enforces. `limits.simulation.json` is deleted.

Payload:

```json
{ "requestId": "<32 hex>", "nullifierHash": "<64 hex, big-endian>", "requestBinding": "<64 hex: must equal the staged binding>", "relayer": "<base58 pubkey that sent stage_spend>" }
```

**Result** (the last line after `Workflow Simulation Result:`, a JSON string):
- success: `{"requestId":"…","txStatus":"SUCCESS","txSignature":"<base58>"}`
- refusal: `{"requestId":"…","txStatus":"…","error":"NullifierUsed (0x1776)"}`. `error` is a brizo_pool error name; `NotStaged (0x1780)` means stage didn't happen or didn't land.

Treat anything other than `SUCCESS` as a refusal and don't run infer.

**Reference client:** `npx tsx scripts/make-request.ts --i <n> --relayer <pubkey>` (from `workflows/`, under Node). It builds a real request from on-chain state: Leaves + Tree over RPC, the sealed envelope, the binding, a Groth16 proof. It writes `fixtures/requests/<id>/{stage,spend,infer}.json`.

### 1+2 in one workflow: brizo-request (E15, preferred)

After stage (1a), a single simulation replaces brizo-spend + brizo-infer:

```bash
cre workflow simulate ./brizo-request --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/<requestId>-request.json --broadcast --wasm "$PWD/build/brizo-request.wasm"
```

Payload: the infer payload plus `nullifierHash` and `relayer`:

```json
{ "requestId": "…", "ciphertext": "…", "nonce": "…", "clientPub": "…", "requestBinding": "…", "nullifierHash": "…", "relayer": "…" }
```

What it does:
1. In the TEE: check the binding, open the envelope, call the model, seal the answer.
2. Cross back with only the sealed ciphertext.
3. Finalize the Spend on Solana; the program checks the binding against the staged spend.
4. Post the sealed answer to the mailbox **only if the spend landed**.

Result:

```json
{"requestId":"…","status":"delivered|model_error|spend_refused|bad_binding|decrypt_failed|bad_envelope|too_long","delivered":true|false,"spendTx":"<base58, when paid>","error":"<on spend_refused>"}
```

The mailbox POST now comes from the DON side, not the enclave. It's the same body, which is ciphertext sealed to the user.

**Faster runs:** after any workflow change, run `scripts/build-wasm.sh` once, then pass `--wasm "$PWD/build/<workflow>.wasm"` to every simulate. That's about 4 s per run instead of 8 s.

**RPC:** `project.yaml` reads `${SOLANA_DEVNET_RPC_URL}` from `workflows/.env`. Use a private devnet RPC; the public one returns 429s.

### 2. brizo-infer (only after spend returned SUCCESS)

```bash
cre workflow simulate ./brizo-infer --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/<requestId>-infer.json
```

No `--broadcast` (it writes nothing on-chain) and no `--limits`.

Payload: the browser's envelope minus the proof.

```json
{
  "requestId": "<32 hex>",
  "ciphertext": "<base64 nacl.box of UTF-8 JSON {question, bands}>",
  "nonce": "<base64, 24 bytes>",
  "clientPub": "<base64, 32-byte x25519 key, fresh per request>",
  "requestBinding": "<64 hex: the same value as the spend payload>"
}
```

What the enclave does:

1. Checks `requestBinding == BE(sha256(requestIdBytes ‖ ciphertextBytes) mod r)`.
2. Opens the box with its secret key and enforces the 12,000-character cap.
3. Calls the model.
4. POSTs to `<mailboxBaseUrl>/mailbox/<requestId>` with a JSON body:

```json
{ "requestId": "<32 hex>", "ciphertext": "<base64>", "nonce": "<base64>" }
```

The nonce is `sha256(requestIdBytes ‖ clientPub ‖ "answer")[0..24]`. The browser opens the answer with `nacl.box.open(ciphertext, nonce, enclavePub, clientSecretKey)`. The plaintext is either of:

- `{"ok":true,"answer":"<model JSON per SPEC §6, as a string>","finishReason":"stop","model":"anthropic/claude-haiku-4.5"}`
- `{"ok":false,"error":"model_unavailable"}`

The mailbox must answer 2xx. The gateway must refuse a `requestId` it has already seen (D3).

**Result:**

```json
{"requestId":"…","delivered":true|false,"status":"delivered|bad_binding|decrypt_failed|bad_envelope|too_long|model_error"}
```

`delivered` is true when the mailbox accepted the POST. On `model_error`, the sealed notice is still delivered, so the browser doesn't wait forever.

Test helpers:

- `bun run scripts/make-infer-fixture.ts` builds a valid payload the way the browser will.
- `bun run scripts/mock-mailbox.ts` is a stand-in mailbox on :8787 that decrypts the test answer.

### 3. brizo-settle (cron; a person or the gateway runs it periodically)

```bash
cre workflow simulate ./brizo-settle --target simulation-settings --non-interactive --trigger-index 0 --broadcast
```

The result has the same shape as spend, with `epoch` in place of `requestId`.

## For lane B: what deploy/devnet.json needs

`scripts/apply-devnet-config.ts` reads these keys (base58 strings):

- `programId`, `pool`, `tree`, `nullifiers`, `vault`, `operator` (the operator's tUSDC token account);
- optionally `forwarderProgramId` and `forwarderState`, which default to the CRE simulator mock forwarder `7kuEAA3m…` / `5Tipz3yh…`;
- optionally `tokenProgram`, which defaults to SPL Token.

The Pool used by simulations must be initialised with `forwarder_program = 7kuEAA3mSC1Tz8gQjnvH7bKFda9xSPRRin9SZbH49cNK`.

`on_report` account order, as the workflows send it:

| Report | Accounts |
|---|---|
| Spend (D6 finalize) | `[forwarderState (w), forwarderAuthority, pool (w), pending (w), nullifiers (w), relayer (w)]` |
| Settle | `[forwarderState (w), forwarderAuthority, pool (w), vault (w), operator (w), token_program]` |

`forwarderAuthority` = PDA `["forwarder", forwarderState, programId]` under the forwarder program. The forwarder strips the first two accounts before it CPIs into `on_report`.

## D6. Two-phase spend (approved 7 Oct ~17:50 SGT; supersedes the Spend part of D1)

A real DON enforces the 265 B Solana report limit, and the compressed Spend report was 370 B. So:

```rust
enum BrizoReport {
  Spend  { nullifier_hash: [u8;32], request_binding: [u8;32] },   // variant 0, 65 bytes (finalize)
  Settle { epoch: u64 },                // variant 1, 9 bytes
}
```

- **`stage_spend`** (new direct instruction, signed by the relayer) checks the root history and that the nullifier isn't already in `NullifierSet`, verifies the Groth16 proof, and creates `PendingSpend { pool, nullifier_hash, request_binding, relayer, staged_slot }` at PDA `["pending", pool, nullifier_hash]`. Emits `Staged`.
- **`on_report(Spend)`** accounts: `[forwarderState (w), forwarderAuthority, pool (w), pending (w), nullifiers (w), relayer (w)]`. It checks the PDA, the recorded relayer and **that `request_binding` equals the staged one (`BindingMismatch`, 6017)**, inserts the nullifier (`NullifierUsed` on reuse), increments `spends`, emits `Spent { nullifier_hash, request_binding }`, and closes `pending` to the relayer. Unstaged → `NotStaged` (6016, 0x1780).
- **Measured (localnet, 16/16 tests):** stage 119,543 CU under its own 400k budget; finalize through the forwarder 12,906 CU. On devnet, finalize passes CRE's default limits.
- **Lane C** must switch the gateway to stage-then-finalize (1a/1b above) and drop `--limits`. The proof format (compressed, A negated) is unchanged.

## Contract decisions (7 Oct, ~10:05) — need to be copied into SPEC.md

These change shared contracts in `docs/SPEC.md`. Lane A cannot edit SPEC.md; a person has to apply them there and tell lanes B and C.

### D1. Spend report uses compressed proof points (affects B and C) — Spend layout and `--limits` superseded by D6; the compressed-point format still applies to `stage_spend`

Why: `cre workflow limits export` (CLI v1.37.0) shows the production defaults, which the simulator also enforces:

- a Solana report may be at most **265 bytes**;
- a Solana write may use at most **300,000 compute units**.

`BrizoReport::Spend` as specced is 353 bytes of payload plus the 32-byte account hash, so it does not fit.

New layout (SPEC §4.3):

```rust
enum BrizoReport {
  Spend  { root: [u8;32], nullifier_hash: [u8;32], request_binding: [u8;32],
           proof_a: [u8;32], proof_b: [u8;64], proof_c: [u8;32] },   // compressed points
  Settle { epoch: u64 },
}
```

- Size: 1 + 96 + 128 = 225 bytes of payload.
- **Measured 10:16:** the 265-byte limit covers the *whole signed report*: 109 bytes of CRE metadata, plus a 36-byte forwarder header (32-byte account hash, 4-byte length), plus the payload. A compressed Spend is therefore **370 bytes**. Under the default limit, the payload can be at most 120 bytes, so no Spend that carries a proof fits.
- **Decision (10:20, person 1): raise the limit in simulation only.** Every `brizo-spend` simulate passes `--limits "$PWD/limits.simulation.json"`. That file (in `workflows/`) is the exported defaults with only `ChainWrite.Solana.ReportSizeLimit` raised to `512b`. Tested: the report reaches the mock forwarder and the tx fits.
- **Compressed points are still required.** The S2 tx was 910 bytes with a 205-byte report. A 370-byte compressed Spend plus 2 more accounts comes to about 1,139 bytes, which fits Solana's 1,232-byte limit. An uncompressed 498-byte report would be about 1,267 bytes, which doesn't.
- **Lane C** converts the snarkjs points as the `groth16-solana` README says, including the negation of `proof_a`. It then compresses `proof_a` and `proof_c` (G1, 64 → 32 bytes) and `proof_b` (G2, 128 → 64 bytes) in the alt_bn128 compressed format.
- **Lane B** decompresses with `groth16-solana`'s `decompress_g1` / `decompress_g2` before verifying.
- **Compute (measured 10:09, S3):** the simulator refuses any `computeLimit` above 300,000. Even at 300,000, the broadcast tx carries no ComputeBudget instruction, so the forwarder runs on the default 200,000 CU and **the receiver gets about 191,000 CU**. The whole `on_report` Spend path (decompression, Groth16 verify, nullifier insert) must fit in about 190,000 CU. S5 must measure this. Rough estimate: the alt_bn128 pairing for 4 pairs is about 85k CU, plus about 15k for the 3 input multiplications, plus decompression.
- **README honesty:** a DON deployed with the default limits would reject the 370-byte Spend report. The path to production is a stage/finalize split: the gateway's relayer verifies the proof on-chain in a `stage_spend` tx, and CRE writes a 33-byte `Spend { pending_hash }`. Put that on the "Limits and roadmap" slide.

### D2. Request binding bytes (affects B and C)

`requestBinding = sha256(requestIdBytes ‖ ciphertextBytes) mod r`, where:

- `requestIdBytes` = the 16 bytes from hex-decoding the 32-character `requestId`;
- `ciphertextBytes` = the raw `nacl.box` output, i.e. the base64 `ciphertext` decoded;
- the 32-byte digest is read as a **big-endian** integer and reduced mod r (the BN254 scalar field);
- in the report and in the `groth16-solana` public inputs, the result is **32 bytes big-endian**;
- in snarkjs `publicSignals`, it is the usual decimal string.

The same encoding (32 bytes big-endian) applies to `root` and `nullifier_hash`.

### D3. Answer nonce (affects C)

`nonce = sha256(requestIdBytes ‖ clientPubBytes ‖ "answer")[0..24]`, where:

- `requestIdBytes` is 16 bytes;
- `clientPubBytes` is the 32-byte x25519 public key;
- `"answer"` is ASCII.

The gateway must refuse a `requestId` it has already seen. That way one key pair never seals two different answers under the same nonce.

### D4. Mailbox URL comes from config, not the payload (affects C)

The `brizo-infer` payload is `{ requestId, ciphertext, nonce, clientPub, requestBinding }`; it no longer carries `mailboxUrl`.

- The enclave posts `{ requestId, ciphertext, nonce }` (base64) to `<mailboxBaseUrl>/mailbox/<requestId>`.
- `mailboxBaseUrl` is set in the workflow config (`workflows/brizo-infer/config.*.json`).
- **Why:** the enclave should not send data to whatever URL a caller supplies.

### D5. Model provider: OpenRouter (affects C's eval)

The model call goes to OpenRouter's OpenAI-compatible endpoint: `POST https://openrouter.ai/api/v1/chat/completions`.

- The model ID comes from config; the default is an Anthropic Haiku-class model.
- The secret is `MODEL_API_KEY`. A user can reuse the same OpenRouter key as `OPENROUTER_API_KEY` for the E4 judge.
- `max_tokens = 1000`, not 2000, because CRE's HTTP action timeout is 10 s.
- A direct Anthropic Messages API adapter comes later as E17.
