# Lane C — ZK and gateway handoff

## Current publication — 7 Oct 2026, 17:58 IST (20:28 SGT)

At the user's explicit request, removed the three `xipharis` commits from shared
main's ancestry and pushed **`377017a`** with an exact `--force-with-lease`.
The published file tree is unchanged; all A/B/C/D implementation is preserved.
Aligned local lane branch references to the rewritten history without changing
their files. Other clones must fetch and reconcile before pushing old history.
GitHub reported the configured origin redirects to **akronim26/brizo-old**.

The three requested gateway fixes are complete: HTTP stage confirmation,
allowlisted program refusal names, and the private workflow RPC for the faucet.
Fresh verification: **35 tests / 198 assertions**, TypeScript passes. The user
now confirms the private devnet RPC is configured, resolving the earlier hold,
and reports the full gateway flow succeeded live in 14 seconds. C has submitted
no additional live transaction. Shared-note indices 0–4 are used or staged;
fresh test proofs must use **i >= 5**. Restart the gateway to load the fixes.
Optional duplicate-pending recovery remains deferred at the freeze. E4, E7 and
the deferred P2 items are not completed; no new feature or multiparty claim.

## Current: HTTP staging confirmation + private-RPC faucet — 7 Oct 2026, 17:38 IST (20:08 SGT)

Reviewed the user's uncommitted staging patch and retained raw-send plus HTTP
confirmation, avoiding the unavailable WebSocket subscription. Added focused
coverage and kept the combined Request contract below.

Runtime fix **`8b19838` is pushed to shared main**, integrated by `de3b2f0`.
Pull main and restart the gateway to load the HTTP confirmation/private-RPC faucet.

- Stage polling uses `getSignatureStatuses` with history search, accepts only
  `confirmed`/`finalized`, and refuses failed or unknown expired transactions.
  A transaction already processed can still confirm after blockhash expiry.
  Preflight remains enabled and the 400,000-CU proof transaction is unchanged.
- A/D: `/api/ask` now surfaces allowlisted Brizo stage error names such as
  **`NullifierUsed`**, `UnknownRoot` and `InvalidProof`. No Request runs after a
  staging refusal. Unknown diagnostics remain `stage_refused`; raw RPC errors,
  logs and environment values are never returned.
- The faucet consumes **`SOLANA_DEVNET_RPC_URL` from the same WORKFLOWS_DIR/.env**
  through an isolated Bun CLI. Both account reads and every SPL Token/Solana
  funding command use that URL. The CLI checks devnet before any funding and
  removes unrelated enclave/model credentials. No additional RPC copy is needed
  in gateway/.env, and the URL is excluded from public config/logs/results.
- Faucet remains **20 tUSDC + 0.02 SOL**, with opaque signer paths and one attempt
  per wallet/hour. Its child signing commands now inherit the worker's process
  group so an outer timeout cannot leave a mint/transfer running behind the queue.
- A's latest paid-but-undelivered `answered` result retains `spendTx` and returns
  `inference_failed`; it cannot release an answer. Paid delivery still requires
  the validated final delivery result plus the callback.
- Local verification: **35 tests pass**, TypeScript passes, independent review
  has no remaining Critical/Important findings. The user reported landed stages
  under the earlier confirmation path; this update adds no agent-submitted live
  transactions or new live evidence. Live CRE remains on the earlier confirmation
  hold. Restart the gateway after pulling this change to use the new code.

## Combined Request contract — 7 Oct 2026, 19:30 SGT

User explicitly approved A's updated D6/E15 contract. Imported committed A/B
context through `fa98900` with merge `35e3fee`; no other lane's source was
manually edited. Existing circuit keys, compressed proof format, enclave public
key and decoded-byte binding formula below are unchanged.

Gateway implementation **`3033573` is pushed to shared main**. A/D can pull main
for the current integration; the earlier unpushed D6 commit is included too.

- After binding/snarkjs verification, `/api/ask` stages the six unchanged proof
  fields with **400,000 CU**, then runs exactly **one `brizo-request`** simulation.
  Payload: `{requestId,ciphertext,nonce,clientPub,requestBinding,nullifierHash,relayer}`.
  The binding is the same BE32 hex value supplied to stage. CRE uses
  **`--broadcast --wasm <WORKFLOWS_DIR>/build/brizo-request.wasm`**, no `--limits`.
  The 65-byte Spend report includes the staged binding and fits default limits.
- Request seals the answer in the TEE, finalizes payment, then posts the sealed
  answer. C releases it only after a matching `delivered`/`model_error` result,
  valid `spendTx`, `delivered: true`, and an actual callback. An early callback
  remains pending. C immediately persists a matching public CRE payment log
  for timeout/restart diagnostics; that log never authorizes answer release.
  A failed paid delivery retains both `stageTx` and `spendTx` when observed.
- **A/D API compatibility:** successful Ask/Answer shapes remain unchanged;
  pending/failed status exposes stage diagnostics. E2 still requires a fresh
  envelope/proof for the same credit: identical IDs are reserved permanently.
- **Local configuration:** user confirmed `RELAYER_KEYPAIR` is set locally in
  `gateway/.env`. A's `workflows/.env` must contain the private
  `SOLANA_DEVNET_RPC_URL`. CRE and the isolated Node signing CLI consume that
  file opaquely; the gateway does not open it. Staging checks devnet genesis
  before reading the signer. No private RPC/key values belong in this handoff.
- Ran A's `bash scripts/build-wasm.sh` successfully; all four bundles built.
  Request bundle: **3,805,947 bytes**, SHA-256
  `34e5271d3d77dec97502c0c8d02471997d34aaee154d09ab455fc7c867c59d74`.
  Rebuild after workflow changes. Missing/malformed Request WASM refuses Ask.
- Local verification: **28 gateway tests pass**, TypeScript passes. Signing/CRE
  are boundary doubles; **no new live C stage/payment signature**. User asked
  to hold live CRE until explicit private-RPC confirmation. Restart the gateway
  to load local configuration when that confirmation arrives.
- At the 19:30 checkpoint, no P2 was started. Remaining lane work: live gateway
  acceptance/E6 checks, E4's 20-profile evaluation, and E7's human ceremony.
  E7 changes the keys and requires coordinated B/D updates; no multiparty claim.
  SDK, x402 and Tor remain deferred. Feature freeze is 20:30 SGT.

## Historical: D6 two-phase Spend — 7 Oct 2026, 18:44 SGT

User explicitly requested D6 and confirmed B's upgrade is live. Imported
committed A/B work through `29d9b31`, including public deployment and IDL;
shared SPEC was not manually edited and no other lane's implementation changed.

- `/api/ask` now checks binding/snarkjs, stages the unchanged compressed proof
  using the deployed IDL and **400,000 CU**, waits for confirmed success, then
  runs CRE Spend with only `{requestId,nullifierHash,relayer}` and `--broadcast`.
  **No `--limits`.** Infer and its payload are unchanged; only matching Spend
  `SUCCESS` plus a valid signature can start it.
- `gateway/.env.example` adds **RELAYER_KEYPAIR**. A person fills this in locally
  with a funded devnet signing-file path, preferably absolute. About 0.002 SOL
  pending-account rent is refunded at finalize. Gateway never needs the enclave
  secret or model API key: point `WORKFLOWS_DIR` to A's credentialed workflows.
- A/D: successful Ask and Answer response shapes remain unchanged. Pending or
  failed responses additionally expose `stageTx` for diagnosing a confirmed
  stage whose finalize failed. `stage_refused` means no CRE/Infer was invoked.
  Exact reused envelopes still return `request_id_reused`; E2 must make a fresh
  envelope/proof for the same spent credit to reach on-chain rejection.
- Existing SQLite databases migrate automatically to add `stage_tx`. Staging
  stays in the same single queue, survives queue TTL during execution, and is
  never automatically retried after timeout/restart. Confirmed stage signatures
  are logged and persisted; failed finalize may leave rent in the pending PDA.
- Local verification: **22 gateway tests pass**, TypeScript passes; real Node 23
  encodes the deployed D6 instruction with the expected 232-byte instruction
  data and pending PDA. Signing/CRE are boundary test doubles so far; no live
  stage/spend signature from C yet. Live test needs local relayer provisioning.
- Review caught a restart after the queue deadline hiding stage diagnostics;
  interrupted jobs now receive a fresh 15-minute diagnostic TTL. The regression
  passes. HTTP startup/config/artifact-hash/private-mailbox checks pass with
  signing deliberately disabled; unconfigured Ask returns 503 before reservation.

Earlier D1–D4 entries below are historical; D6 supersedes one-phase Spend and
the custom report-limit requirement. Existing circuit keys/conversion stay valid.

## Approved D1–D4: circuit conversion and gateway — 7 Oct 2026, 15:48 SGT

User explicitly approved HANDOFF-A D1–D4. Adoption hold is resolved; shared
SPEC remains for a person to update. No lane A/B/D implementation was edited.

- B: use `circuits/build/sample-spend-compressed.json` (A/C 32 bytes, B 64),
  with `verification_key.json` / `verifying_key.rs` already delivered. The
  Node converter matches native Solana compression byte for byte; native
  groth16-solana 0.2.0 decompression and proof verification both pass. A is
  negated once **before** compression. Existing keys do not change.
- A/D: reuse `yGXMouHzxRWeSdtpGtaQ7Y5O673c91NaXg2nkD+kkmg=`. Binding remains
  SHA256(decoded 16-byte ID || decoded ciphertext), big-endian mod scalar r;
  snarkjs decimal, workflow/public input bytes big-endian 32-byte hex.
- Gateway implementation is in `gateway/`; see its README and `.env.example`.
  Public API/proving files listen on loopback **8788**; private mailbox on
  **8787**, matching A's config. Expose only 8788. No payload mailbox URL.
  SQLite reserves IDs permanently, answers expire in 15 min and consume on
  first successful read. The nonce is SHA256(ID bytes || clientPub bytes ||
  ASCII answer)[0:24]. One queue covers both CRE simulations and the faucet.
- `/api/config`: public pool addresses plus `enclaveBoxPublicKey`,
  `circuit.{wasmUrl,zkeyUrl,verificationKeyUrl,sha256}`, and readiness flags.
  Asset URLs are relative to the gateway's origin. Ask/answer response shape
  follows SPEC; sealed model failure notices are delivered normally.

**Live integration needs:** B's public `deploy/devnet.json` (programId, pool,
tree, nullifiers, vault, operator, mint, leaves) and IDL; A must apply it to
its workflow configs. User provisions a funded devnet faucet signer path in
`gateway/.env` locally, and optionally a separate mint-authority path. No key
values in chat. Point `WORKFLOWS_DIR` to A's existing credentialed directory.

**A config fix received:** A fixed the fallback Token program address in
`5f19f85`, merged into main as `6afefff`. Its helper and C now use
`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`. B can also set `tokenProgram`
explicitly in devnet.json. No further A fix is needed for that address.

Local gateway tests (15 passing plus TypeScript) include the real snarkjs verifier; CLI signing/CRE calls
are test doubles. HTTP smoke downloads match committed artifact hashes. No
live Brizo Spend/faucet signature from C yet; B's deployment file is absent.
E6 controls are included in P0 implementation. E4/E7 and P2 remain checkpoint
gated per PLAN; no evaluation numbers or multiparty ceremony claim yet.
Independent review found and verified a queue-expiry fix: active workflows
are governed by CLI timeouts, and answer retention starts at the callback.
No remaining important review findings; live integration is still required.

## Context import — 7 Oct 2026, 15:22 SGT

At the user's request, merged `main` (`141b61d`, already containing lane A
through `9891987`) into lane-c. Clean automatic merge, including both lanes'
evidence; no circuit artifacts overwritten and no lane A implementation edited.
The committed A handoff, workflows and public enclave key are now in this
worktree. Adoption was pending at import; now resolved above.

Verification after import: workflow TypeScript check passed; five workflow
encoding tests passed; lane A's binding code matched C's approved literal
binding vector. C's four circuit/proof tests and native Rust verifier passed.
Initial locked dependency download stalled; canceled it and reused A's existing
installed dependencies through symlinks inside an ignored `workflows/node_modules/` directory.
For a standalone checkout, install with `bun install --frozen-lockfile` instead.

What already works according to A's evidence: TEE HTTP trigger, box/hash crypto,
template devnet write, chain write after TEE crossover, real OpenRouter call,
sealed answer delivery and bad-binding refusal. All three Brizo workflows exist.
Spend's smoke path reaches the template receiver but is refused there; no
Brizo proof was verified on-chain yet. Spend/settle still require B's real
receiver and `deploy/devnet.json`. Latest infer config is **600 maxTokens**, with
model timeout converted into a sealed `model_unavailable` notice.

At import, C needed approval to adopt A's D1/D3/D4 wire contract and simulation
limits. The user has now approved them; D2 already matched.
For live faucet/spend validation later: B's public addresses/IDL and an opaque
local funded devnet faucet/mint-authority signer path. No pasted keys needed.
Reuse A's existing published enclave public key and locally provisioned matching
secret/model credentials; do not create a mismatched replacement key.

## Current: S7 passed — 7 Oct 2026, 12:56 SGT

User approved the circuit corrections and decoded-byte binding formula.
Production circuit compiled with `--O2`: 2,927 constraints, depth 10, three
public inputs in order `[root, nullifierHash, requestBinding]`.
Node 23 `fullProve` took **409 ms**; snarkjs verified it and rejected independent
tampering of every public input. The Rust host verifier also verified the
converted proof with **groth16-solana =0.2.0** and rejected all three mutations.
This is host verification; lane B still owns S5's on-chain/forwarder evidence.

### Lane B: files ready in `circuits/build/`

**Historical integration hold (now resolved):** after completing S7, C read lane A's live worktree
`docs/HANDOFF-A.md`. Its D1–D4 alter the shared wire contract: compressed
proof points (32/64/32), raised simulator report-size limits, config-owned
mailbox URL, and answer nonce bound to clientPub. C asked the user to approve
adoption, per the shared-SPEC stop rule. `sample-spend.json` remains an
uncompressed host-verifier fixture, **not** a payload accepted by A's current
workflow. Existing proof, zkey, and verification keys do not need changing.

- `verification_key.json`, `verifying_key.rs` (`VERIFYINGKEY`, groth16-solana 0.2.0).
- `sample-proof.json`: snarkjs proof, decimal publicSignals and converted bytes.
- `sample-spend.json`: exact `{ requestId, root, nullifierHash, requestBinding,
  proofA, proofB, proofC }`, fixed-width hex without `0x`.
- `proof.json`, `public.json`: plain snarkjs fixtures.
- `poseidon-vectors.json`: commitment, nullifier, zeros starting at zero leaf,
  and one-deposit depth-10 root for S5 parity checks.
- `credit.wasm`, `credit_final.zkey`: browser prover files.
- `s7-results.json`: proof timing and verification result.

The Rust key matches the official **v0.2.0** `parse_vk_to_rust.js` after ignoring
formatting. That release uses the field spelling `vk_gamme_g2` and writes
`nr_pubinputs: 4` (IC length); actual proof input count is three. Do not paste
this export into a newer incompatible crate without re-exporting.

**Proof format:** G1 is `x_BE32 || y_BE32`; negate proof A's y coordinate modulo
the BN254 **base field** before verification. `sample-spend.json` already has
negated A; do not negate twice. G2 is `x_im_BE32 || x_re_BE32 || y_im_BE32 ||
y_re_BE32`. Public inputs are scalar-field BE32, ordered root/nullifier/binding.

### Lane A and D: approved binding contract

Lane A independently published the same decoded-byte formula (D2). Its
worktree already has public enclave key `yGXMouHzxRWeSdtpGtaQ7Y5O673c91NaXg2nkD+kkmg=`
in `workflows/enclave-public-key.json`. C read only that public artifact; no
matching secret was accessed. Coordinate one key for gateway config and the
enclave; avoid generating a mismatched replacement without rotation.

Decode lowercase 32-hex-character requestId into 16 bytes; decode canonical
base64 ciphertext into box bytes. Concatenate `requestIdBytes || ciphertextBytes`,
SHA-256, interpret digest as an unsigned big-endian integer, reduce modulo
`r = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.
Encrypt first, then compute the binding, then prove. Public signals are decimal
strings; the spend/infer payload's requestBinding is 64 hex characters.

Cross-lane vector is `circuits/build/binding-vector.json`:
requestId `000102030405060708090a0b0c0d0e0f`, ciphertext `aGVsbG8=`, SHA-256
`7c9f5b9e4cc36c703715bb6eedcbb8bd80840fd48d135a07af861d1a027be360`, decimal binding
`12591868490619502940983479717201964167859440711926496621633181383191911195486`.
This short ciphertext is a hash test vector, not an actual box envelope.

### Setup and integrity

Public Hermez power-12 ptau from `https://circom.info/powersOfTau28_hez_final_12.ptau`;
its **BLAKE2b-512** matches the snarkjs README's published digest. Then one local
phase-2 contribution, verified with `snarkjs zkey verify` (`ZKey Ok!`). Currently
single-party phase 2; never claim a public/multi-party ceremony yet.

Public contribution hash:
`ec845aebdcb87ce8ef8049a37f1fddedaf1a590463b185f6304d787de4a88450cec170f4f872b50f3ef9cf6ece45d35ec1a33375994e9f14e95a1a570e5cfc7a`.

SHA-256 artifacts:

| File | SHA-256 |
|---|---|
| credit.wasm | `987dbaffe2205254257c6515c623b512312f4414052c9c6beb9b17958993b0dc` |
| credit_final.zkey | `3936dc2486884d764d234842a278fb4a5e36f29daba1ec9866aaea220e6bb8a3` |
| verification_key.json | `14b5f1ca74a45d24f479d95fa0785609a6a1b6dea5d4facb3712c3824823ac6c` |
| verifying_key.rs | `e1f0c468baefa5caf1d6e2524fbaa241b59a30522a20495389f96d2aef3ebba4` |

Run from `circuits/`: `npm ci --ignore-scripts`, `npm run compile`,
`npm test`, and `NO_DNA=1 cargo run --locked --manifest-path rust-check/Cargo.toml`.
Use Node 23 explicitly or activate it in PATH. Build intermediate files are
ignored; browser/key/fixture exports are committed. Human contributions later
change the final keys: regenerate all exports and notify B and D together.

## Historical: 7 Oct 2026, 12:47 SGT — initial S7 blocker (resolved above)

Branch: `lane-c`, worktree: `~/Desktop/brizo-C`.
Read `CLAUDE.md`, `docs/SPEC.md`, `docs/PLAN.md`, `docs/SUBMISSION.md`,
and the repo's `chainlink-cre-skill` and `solana-dev` skills in full.

Do not consume a verifying key yet: no production circuit, trusted setup,
proof fixture, or keys have been generated.

Confirmed with circom 2.2.3 and snarkjs 0.7.6:

1. The specified `requestBinding * requestBinding === requestBinding * requestBinding`
   fails compilation with `Non quadratic constraints are not allowed!`.
2. `LessThan(8)` alone admits `i = r - 1`, where
   `r = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.
   Its internal 9-bit value is `i + 256 - 200 = 55 (mod r)`.
   This admits credit indices outside `0..199`.

Proposed correction, awaiting user's shared-contract decision:

```circom
component indexBits = Num2Bits(8);
indexBits.in <== i;
// Keep LessThan(8)(i, 200).out === 1.
signal bindingSquare;
bindingSquare <== requestBinding * requestBinding;
```

Keep the public input order exactly `[root, nullifierHash, requestBinding]`.
The diagnostic confirms that the private square keeps the binding in R1CS;
full Groth16 tamper verification is still required before handing off keys.

Run the throwaway reproduction:

```sh
/Users/sohamvijay/.nvm/versions/node/v23.11.1/bin/node circuits/spikes/check-spec.mjs
```

## Binding and app sequencing — clarification required

Proposed byte contract (not yet adopted): decode the 32-hex-character request ID
to 16 bytes, decode canonical base64 ciphertext, concatenate those bytes,
SHA-256, interpret digest as an unsigned big-endian integer, reduce modulo `r`.
Public signals are canonical decimal strings; Solana field bytes are 32-byte
big-endian. Publish a cross-lane test vector once the byte contract is approved.

SPEC §4.6 currently proves before encrypting, but the proof's binding requires
the ciphertext: the app must encrypt before proving. No shared SPEC edits made.

Gateway integration also needs an authenticated mailbox or an unguessable
per-request callback capability, so third parties cannot replace answers.

## Dependencies and pending handoffs

- Lane A: exact commands/payloads in `docs/HANDOFF-A.md` (not present yet).
- Lane B: `deploy/devnet.json`, mint and program IDL (not present yet).
- Enclave key: not generated yet. A future local utility must save the secret
  without printing it; only its public key belongs in config and this handoff.
- Three-party ceremony: wait until the circuit is fixed and initial S7 is verified;
  then coordinate two independent human contributions before regenerating all
  final exports. No teammate contribution needed yet.
- Shell defaults to Node 18.20.8; Node 23.11.1 is available at the path above.
- No deployment, transaction, secret-file access, or mainnet action performed.
