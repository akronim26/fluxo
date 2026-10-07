# Lane A (CRE) — transfer to the lane B owner

> **Update 7 Oct, ~20:10 SGT: the state below is from 13:20 and is superseded.** Current state is in `README.md`, `docs/HANDOFF-A.md` and `docs/EVIDENCE.md`. In short:
> - The project is **simulation-only** (CRE deploy access wasn't granted), so E16 is dropped.
> - Spends are two-phase (D6), and the Spend report fits CRE's default limits; `limits.simulation.json` is deleted.
> - The E15 `brizo-request` workflow is the main path.
> - The full flow has run live through the gateway on devnet.
> - The RPC comes from `SOLANA_DEVNET_RPC_URL` in `workflows/.env`; use prebuilt WASM via `scripts/build-wasm.sh`.
> - `scripts/settle-loop.sh` runs Settle on its cron cadence.


Written 7 Oct 2026, 13:20 SGT, by the outgoing lane A session. It covers everything needed to continue lane A: what exists, how to run it, what is still to do, what to wait for, and the traps already hit. A ready-to-paste prompt for your Claude Code session is at the end.

Read this together with:

- `docs/HANDOFF-A.md`: the wire contract (D1–D5), the exact simulate commands, payload and result shapes, and what `deploy/devnet.json` must contain.
- `docs/EVIDENCE.md` → "Lane A — CRE": every spike result, transaction and measurement so far.
- `CLAUDE.md`, `docs/SPEC.md` (§4.4, §11.13–11.15), `docs/PLAN.md`.

---

## 1. Where lane A stands (13:20)

| Item | Tier | State |
|---|---|---|
| Spikes S1, S2, S3, S4, S6 | Phase 0 | **All pass** (evidence + devnet txs in `docs/EVIDENCE.md`) |
| `cre account access` | Phase 0 | Requested via the CLI form. `cre whoami` showed "Deploy Access: Not enabled" before the request |
| C3 `brizo-infer` | P0 | **Done in simulation**, with a real OpenRouter call inside `handlerInTee`. The answer is sealed to the client key, posted to a (mock) mailbox and decrypted. A tampered binding is refused |
| C2 `brizo-spend` | P0 | Code written and type-checked. A smoke test reached the mock forwarder. **Needs lane B's program + `deploy/devnet.json`** |
| E1 `brizo-settle` | P1 | Code written and type-checked. **Needs lane B's Settle instruction + addresses** |
| Lane C handoff (due ~13:30) | — | **Done**: `docs/HANDOFF-A.md` |
| E15, E17, E16, E14 | P2 | Not started (P2 waits for the 17:30 checkpoint) |

Everything is merged to `main` and pushed to https://github.com/akronim26/brizo (`main` @ `141b61d` or later).

---

## 2. Machine setup (do this first if you're not on the original machine)

1. **Toolchain.** CRE CLI v1.37.0 (`~/.cre/bin`), Solana CLI 2.3.0, Node 23.
   - **Bun ≥ 1.2.21** is required. Bun 1.2.16 makes *every* TypeScript workflow fail with `Failed to create engine: failed to execute subscribe ... wasm trap: wasm unreachable instruction executed`. Run `bun upgrade` (1.4.2 works).
2. **`cre login`.** Browser + 2FA, done by the person. Check with `cre whoami`.
3. **Install.** Run this in `workflows/`:
   ```bash
   bun install
   ```
   One `package.json` at the `workflows/` root serves all three workflows and `lib/`.
4. **`workflows/.env`.** Copy `workflows/.env.example` and fill it. It is gitignored; never commit it or paste it into chat.
   - `CRE_SOLANA_PRIVATE_KEY`: path to a devnet keypair file. It pays fees for `--broadcast`. On the original machine this is `~/.config/solana/brizo-devnet.json`, address `FPxLpgeTVcTXcFM2ugGH5Z7M3GJ39QVDuTCvrJMDAqBL`, ~10 devnet SOL. On a new machine, make your own keypair and fund it at https://faucet.solana.com:
     ```bash
     solana-keygen new --no-bip39-passphrase --silent -o <path>
     ```
   - `CRE_ETH_PRIVATE_KEY`: keep the placeholder from `.env.example`. The CLI demands it for `--broadcast`; it is unused.
   - `SECRET_MODEL_API_KEY`: the OpenRouter key (https://openrouter.ai/settings/keys).
   - `SECRET_ENCLAVE_BOX_SK`: **this must match the public key the app and gateway encrypt to**, `workflows/enclave-public-key.json` = `yGXMouHzxRWeSdtpGtaQ7Y5O673c91NaXg2nkD+kkmg=`. Two options:
     - **(a)** Copy the existing secret from the original machine's `workflows/.env` by hand (AirDrop, password manager). Never through git or chat.
     - **(b)** Generate a new pair. Delete the `SECRET_ENCLAVE_BOX_SK=` line, then run the command below. It writes the secret to `.env` and prints only the public key. Commit the new `enclave-public-key.json` and **tell lanes C and D the new public key**.
       ```bash
       bun run scripts/gen-enclave-key.ts
       ```

The gateway (lane C) runs `cre workflow simulate` from this same `workflows/` directory, so the gateway host needs the same setup and the same `.env` secrets.

---

## 3. The CRE project in one page

```
workflows/
  project.yaml               target simulation-settings → RPC solana-devnet (api.devnet.solana.com)
                             target template-receiver-smoke (spend smoke test only)
  secrets.yaml               MODEL_API_KEY → SECRET_MODEL_API_KEY, ENCLAVE_BOX_SK → SECRET_ENCLAVE_BOX_SK (names only)
  limits.simulation.json     CRE default limits with ONLY ChainWrite.Solana.ReportSizeLimit raised 265b → 512b
  enclave-public-key.json    public box key for app/gateway
  lib/brizo.ts               hex/base64 (QuickJS-safe), requestBinding (D2), answer nonce (D3),
                             BrizoReport Borsh encoders (Spend = 225 B, Settle = 9 B)
  lib/solana.ts              forwarder authority PDA, account list, writeBrizoReport (report → writeReport)
  lib/brizo.test.ts          `bun test lib` (5 tests)
  brizo-infer/               handlerInTee + HTTP trigger; config.simulation.json (model, prompt, mailboxBaseUrl)
  brizo-spend/               handler + HTTP trigger; config.simulation.json is GENERATED (see below)
  brizo-settle/              handler + cron "0 */10 * * * *"; config.simulation.json is GENERATED
  scripts/gen-enclave-key.ts      enclave box key → .env (secret) + enclave-public-key.json (public)
  scripts/make-infer-fixture.ts   builds fixtures/infer.json exactly like the browser will
  scripts/mock-mailbox.ts         stand-in for the gateway mailbox on :8787; decrypts the test answer
  scripts/apply-devnet-config.ts  ../deploy/devnet.json → brizo-spend + brizo-settle configs
  fixtures/                  infer.json, infer.bad-binding.json, spend.smoke.json
```

`@chainlink/cre-sdk` is pinned to 1.23.0. It has both `handlerInTee` and the Solana report helpers. The CRE template pins 1.17.0, but 1.23.0 was verified with the same forwarder (S3).

Run everything from `workflows/`. Use the absolute `--limits` path; a relative one is resolved from the workflow folder and fails.

```bash
# infer (no broadcast, no limits); start the mock mailbox first if no gateway:
bun run scripts/mock-mailbox.ts &
bun run scripts/make-infer-fixture.ts
cre workflow simulate ./brizo-infer --target simulation-settings --non-interactive --trigger-index 0 --http-payload ./fixtures/infer.json

# spend (after apply-devnet-config): --limits is mandatory
cre workflow simulate ./brizo-spend --target simulation-settings --non-interactive --trigger-index 0 \
  --http-payload ./fixtures/<file>.json --limits "$PWD/limits.simulation.json" --broadcast

# settle
cre workflow simulate ./brizo-settle --target simulation-settings --non-interactive --trigger-index 0 --broadcast

# unit tests and typecheck
bun test lib && bunx tsc --noEmit -p tsconfig.json
```

---

## 4. Measured facts and traps (don't rediscover these)

| Fact | Consequence |
|---|---|
| **Solana report size limit is 265 B for the *whole signed report***: 109 B CRE metadata + 32 B account hash + 4 B length + payload | Max payload under default limits is 120 B. Compressed Spend = 370 B total → every spend simulate passes `--limits "$PWD/limits.simulation.json"`. **Decision taken (D1).** The README must say a DON deployed with default limits would reject it; the path to production is stage/finalize (gateway relayer verifies in `stage_spend`, CRE writes a 33 B `Spend{pending_hash}`) |
| **Proof points must be compressed** (A 32 B, B 64 B, C 32 B) | The uncompressed report (498 B) overflows Solana's 1,232 B tx limit; the S2 tx was 910 B with a 205 B report. Compressed ≈ 1,139 B fits |
| `computeLimit` > 300,000 is refused by the simulator (`compute_limit 400000 exceeds maximum of 300000`) | `writeBrizoReport` throws above 300k |
| **The broadcast tx carries no ComputeBudget instruction**: the forwarder runs on the default 200,000 CU, and the receiver had 191,366 CU available (forwarder overhead ≈ 9.3k) | **Lane B: the whole Spend path in `on_report` (decompress + Groth16 verify + nullifier insert) must fit in ≈ 190k CU.** Estimate: pairing (4 pairs) ≈ 85k + 3 scalar muls ≈ 15k + decompression. Measure it |
| HTTP action timeout is **10 s** (also inside the TEE) | Model call: Haiku 4.5, `maxTokens` 600, prompt asks for < 250 words, OpenRouter `provider.sort = throughput`. A timeout is caught → `model_error`, and the sealed notice is still delivered |
| `z.string().url()` fails in QuickJS (no `URL`) | Use the regex `httpUrl` in `brizo-infer/main.ts` |
| No `Buffer`, `atob`/`btoa`, `crypto.subtle`, `fetch` in workflows | `lib/brizo.ts` has its own base64/hex; PDAs via `@solana/web3.js` `PublicKey.findProgramAddressSync` |
| The model sometimes wraps JSON in code fences, and sometimes emits invalid JSON | The enclave strips fences if the inner JSON parses; otherwise it passes the text through (the browser shows plain text, SPEC §6) |
| Simulation always writes through the **mock forwarder** `7kuEAA3mSC1Tz8gQjnvH7bKFda9xSPRRin9SZbH49cNK` (state `5Tipz3yhTBdVsDbaBxZkrp7Gjf3brGq5SKkxReefPMP7`) | The Pool used by simulations must be initialised with that forwarder program, or `on_report` fails with `MismatchedForwarderProgram` |
| `--http-payload` / `--limits` paths | Payload paths are relative to the project root; `--limits` needs an absolute path |
| Deploy access | Not enabled at 10:00; requested later. Check with `cre whoami` |

---

## 5. Contract decisions (D1–D5) and their status

Full text is in `docs/HANDOFF-A.md`. Short form:

- **D1:** `BrizoReport::Spend { root[32], nullifier_hash[32], request_binding[32], proof_a[32], proof_b[64], proof_c[32] }` (compressed points, Borsh variant 0, 225 B). `Settle { epoch: u64 }` (variant 1, 9 B). Spend simulates with the raised report-size limit.
- **D2:** `requestBinding = BE(sha256(hex→16 bytes requestId ‖ raw ciphertext bytes)) mod r`, written as 32 B big-endian. **Lane C's `circuits/lib/protocol.mjs` already matches byte for byte.**
- **D3:** answer nonce = `sha256(requestId16 ‖ clientPub32 ‖ "answer")[0..24]`. The gateway must refuse duplicate `requestId`s.
- **D4:** the mailbox URL comes from `brizo-infer` config (`mailboxBaseUrl`), not the payload. The enclave POSTs to `<base>/mailbox/<requestId>`.
- **D5:** OpenRouter, `anthropic/claude-haiku-4.5`.

**Open issue:** these are **not yet in `docs/SPEC.md`** (the session couldn't edit the shared file), and **lane C is on hold** waiting for the person's approval of D1–D4 (`docs/HANDOFF-C.md`, "Integration hold"). Until lane C adopts D1, its `circuits/build/sample-spend.json` has uncompressed 64/128/64 B points and `brizo-spend` will reject it. The person must approve D1–D4, copy them into SPEC.md, and tell lane C.

Since you also own lane B, **D1 is mostly your program's job**:
- decompress with `groth16-solana`'s `decompress_g1` / `decompress_g2`, then verify with public inputs `[root, nullifier_hash, request_binding]` (32 B BE each);
- dispatch on the Borsh variant byte;
- use the `on_report` account order below.

---

## 6. What lane B must deliver to unblock lane A

- [ ] `brizo_pool` deployed to devnet and **one Pool initialised against the mock forwarder** `7kuEAA3m…`.
- [ ] `on_report` handles Spend (compressed, ≤ ~190k CU) and Settle. Accounts, in exactly this order (the list is hashed into the report):
  - Spend: `[forwarderState (w), forwarderAuthority, pool (w), tree, nullifiers (w)]`
  - Settle: `[forwarderState (w), forwarderAuthority, pool (w), vault (w), operator (w), token_program]`
  - `forwarderAuthority` = PDA `["forwarder", forwarderState, programId]` under the forwarder program. The forwarder strips the first two before the CPI.
- [ ] `deploy/devnet.json` with base58 keys `programId`, `pool`, `tree`, `nullifiers`, `vault`, `operator` (the operator's tUSDC token account), plus `mint`. Optional: `forwarderProgramId`/`forwarderState` (default mock), `tokenProgram` (default SPL Token).
- [ ] At least one real deposit, so lane C can produce a proof against an on-chain root.
- [ ] Error names from SPEC §4.3. The NullifierUsed rejection must be visible in the simulate output for the evidence.

## 7. Lane C status (13:40) — delivered

Lane C adopted D1–D4 (lane-c commits `5d9d92f`, `58790e5`; details in `docs/HANDOFF-C.md` on lane-c):

- [x] **Compressed spend fixture:** `circuits/build/sample-spend-compressed.json`. Proof A is negated once and then compressed; A/C are 32 B, B is 64 B. It is copied into `workflows/fixtures/spend.sample-compressed.json` and passes `brizo-spend`'s schema (225 B payload, 370 B signed report). Its root comes from C's local test tree, so **an on-chain Spend needs a fresh proof against a root that lane B's program actually holds** (after a real deposit).
- [x] **Gateway:** uses the HANDOFF-A commands exactly: `--limits` and `--broadcast` on spend; infer only after spend `SUCCESS`; no `mailboxUrl` in the payload; same enclave public key.
- [x] **Ports:** the gateway's private mailbox is **`localhost:8787`**, which matches `brizo-infer`'s `mailboxBaseUrl`. Its public API/proving files are on `localhost:8788`. **Port 8787 belongs to the gateway:** run `scripts/mock-mailbox.ts` only when the gateway is down (or with `PORT=8789` plus a temporary config change).
- [x] Lane C caught a wrong SPL Token program ID default in `apply-devnet-config.ts`; it is fixed to `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`.
- **Coordinate live tests with lane C.** Don't run manual `cre workflow simulate` runs at the same time as the gateway's; they share the fee payer and the devnet accounts.

---

## 8. Remaining lane A work, in order

**P0 (before the 17:30 go/no-go; 17:00 is the end-to-end rehearsal with lane C):**
1. When `deploy/devnet.json` exists, run this in `workflows/` and commit the generated configs:
   ```bash
   bun run scripts/apply-devnet-config.ts
   ```
2. **Spend broadcast** with lane C's compressed fixture (save it as `workflows/fixtures/spend.json`). Expect `{"txStatus":"SUCCESS","txSignature":…}`. Record the signature and explorer link in `docs/EVIDENCE.md`.
3. **Replay the same payload** and expect a refusal carrying `NullifierUsed`. Record the output (it's the "rejected reused credit" evidence).
4. **Infer against the real gateway mailbox** (not the mock). Record the output. Make sure no secret or plaintext appears in it; the logs only print requestId and status.
5. The 17:00 end-to-end rehearsal with lane C: one question from the command line.

**P1 (17:30–18:45):**
6. **E1 settle:** after real spends, run `brizo-settle --broadcast` and record the Settle tx and that the operator was paid.

**P2 (only if 17:30 passes; 19:30 drops anything not half done; 20:30 freeze), in this order:**
7. **E15, single atomic TEE workflow (1 h). S3 proved it's possible.** One `handlerInTee`: check binding and open the envelope; call `usingTheDons()` and write the Spend report; only on `SUCCESS` call the model, seal and post. If the handler can't resume TEE work after crossing back, use SPEC §11.13's alternative: model first, then the write, and the gateway releases the mailbox only after the nullifier lands. It replaces the gateway's two-step orchestration; coordinate with lane C.
8. **E17, providers by config (30 min).** OpenRouter is already config-driven (`model.url`, `model.model`, `model.provider`). Optional: a direct Anthropic Messages API adapter (`provider: "anthropic"` switch in config; header `x-api-key`, `anthropic-version`; response `content[0].text`).
9. **E16, deploy (1 h).** Only if `cre whoami` shows deploy access. Initialise a second Pool against the real devnet forwarder (program `CXsKEJcs25TQEYU2e5jZ8QTPE3ffMLZhH6BWHrdcCCB5`, state `8QoomCQyPSkJ8WopJbX9B4HyvrFzziwvJdU8hZE6DCr9`, per the template; re-check the Solana forwarder directory). Add a deploy target. **Ask the person before any `cre workflow deploy` or `cre secrets create`.** Note: the 370 B Spend exceeds the deployed 265 B limit, so only `brizo-settle` can work deployed; `brizo-infer` needs Confidential Workflows beta enrolment.
10. **E14, privacy receipts with lane B (1 h).** `Settle` gains `receipts_root[32]` (SPEC §11.12). Settle stays well under 120 B.

**Phase 3 (20:30–22:30), lane A's share:**
11. README technical sections: architecture, the three simulate commands, deployed addresses, explorer links, and honest limits:
    - the report-size limit raised in simulation;
    - the 10 s model timeout;
    - CRE runs in the simulator;
    - the enclave key was generated by us.
12. The CRE submission "evidence" field: paste commands, outputs and signatures from `docs/EVIDENCE.md`.
13. "Limits and roadmap": stage/finalize spends, attested in-enclave keys (R1), and any unbuilt P2 items.
14. Before any deploy, set `debugLogs: false` in `brizo-infer` config (CRE rule: no enclave logs in production).

---

## 9. Rules that still apply

- Never read, print, log or commit `.env`, keypairs or secret values. Scripts may consume them opaquely.
- **Commit messages must not contain a `Co-Authored-By: Claude` line** (the person's instruction).
- Stay in `workflows/`, `spikes/s1–s4,s6`, `docs/HANDOFF-A.md`, this file, and the "Lane A" section of `docs/EVIDENCE.md`. Changes to `docs/SPEC.md` need the person's approval.
- Ask before mainnet anything, `cre workflow deploy`, `cre secrets create`, or spending real funds. Devnet `--broadcast` simulations are fine.
- A feature is done only when its simulate/broadcast has succeeded and the evidence is in `docs/EVIDENCE.md`.
- Work on a lane branch and merge to `main` at handoffs; `main` is pushed to GitHub.

---

## 10. Prompt for your Claude Code session

Open Claude Code in the lane A worktree. On the original machine:

```bash
cd ~/Desktop/brizo-A && git merge main
```

On a fresh clone:

```bash
git clone https://github.com/akronim26/brizo && cd brizo && git worktree add ../brizo-A -b lane-a origin/main
```

Then paste:

```text
Using /chainlink-cre-skill and /solana-dev.

You are taking over lane A (CRE) of Brizo at the TOKEN2049 Origins hackathon (Chainlink "Best workflow
with CRE" primary, "Best Use of Solana" secondary). Deadline tonight, Wed 7 Oct 2026, 23:59 SGT; submit by
23:30. I also own lane B (the brizo_pool Anchor program), so you may be asked to coordinate across both,
but in this session you edit only lane A's files: workflows/, spikes/ for lane A, docs/HANDOFF-A.md,
docs/LANE-A-TRANSFER.md and the "Lane A — CRE" section of docs/EVIDENCE.md. If a shared contract in
docs/SPEC.md needs changing, stop and tell me.

Read in full before doing anything, in this order:
1. docs/LANE-A-TRANSFER.md (state, setup, measured limits, traps, remaining work)
2. docs/HANDOFF-A.md (wire contract D1–D5, simulate commands, payload/result shapes)
3. docs/EVIDENCE.md, section "Lane A — CRE"
4. CLAUDE.md, docs/SPEC.md (§4.3, §4.4, §11.13–11.15), docs/PLAN.md (checkpoints, P2 order)
Read the CRE skill's references/simulation.md and confidential-workflows.md before any cre command.

Rules:
- Never read, print, log or commit .env files, keypairs or secret values. Scripts may consume them.
- Commit messages must NOT include any "Co-Authored-By: Claude" line.
- Ask me before cre workflow deploy, cre secrets create, or anything on mainnet. Devnet --broadcast
  simulations are fine.
- Something is "done" only when its simulation has succeeded and the evidence is in docs/EVIDENCE.md.
- Respect the checkpoints: 17:30 go/no-go, 19:30 drop half-done P2, 20:30 feature freeze.

First reply, in 10 lines or fewer:
(a) confirm the environment: `cre whoami` (also report whether Deploy Access is now enabled), `bun --version`
    (must be ≥ 1.2.21), `cd workflows && bun install && bun test lib && bunx tsc --noEmit -p tsconfig.json`;
    check that workflows/.env exists WITHOUT reading it (only `test -f`), and that
    `solana balance <transmitter address> --url devnet` is funded;
(b) re-run the brizo-infer simulation against scripts/mock-mailbox.ts as a health check;
(c) list which lane B / lane C handoffs exist yet (deploy/devnet.json, a compressed spend fixture,
    gateway mailbox URL);
then continue with LANE-A-TRANSFER.md §8 in order. When deploy/devnet.json appears, run
scripts/apply-devnet-config.ts, broadcast a real Spend, replay it to capture NullifierUsed, and log both.
Ask if anything blocks you.
```

---

## 11. Decisions the person still owes

1. Approve D1–D4, copy them into `docs/SPEC.md`, and release lane C's integration hold.
2. Start lane B if it isn't running:
   ```bash
   git worktree add ../brizo-B -b lane-b
   ```
   Lane B is on the critical path for C2, E1 and the 17:30 checkpoint.
3. Decide whether E15 may start before 17:30. It's P2, so by the plan's rule the answer is no unless P0 is complete.
4. The enclave key on a new machine: copy the existing secret, or regenerate it and tell lanes C/D (§2).
