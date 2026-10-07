# Lane B (Solana) — handoff to the new owner

> **Update 7 Oct, ~17:10 SGT (lane A session, which took over lane B): this handoff is superseded where it conflicts with the code.**
> - The program was deployed from the lane A machine under a **new program ID `HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC`**; `6zTf…` was never deployed. Don't redeploy from another machine.
> - The pool is initialised, the first deposit is done, and `deploy/devnet.json` + IDL are on `main`.
> - Spends are two-phase (HANDOFF-A **D6**): `stage_spend` verifies the proof; `on_report(Spend{nullifier_hash, request_binding})` finalizes.
> - 17 localnet tests pass.
> - See `README.md` and `docs/EVIDENCE.md`.


Written 7 Oct 2026, 14:15 IST / 16:45 SGT, by the outgoing lane B session. Everything needed to continue lane B: what exists, how to build and test it, the traps already hit, the remaining work in order, and a ready-to-paste prompt for your Claude Code session (§7).

Read with:
- `CLAUDE.md`, `docs/SPEC.md` §4.3 (program), §11.10 (E12 redeem), §11.12 (E14 receipts), `docs/PLAN.md`, `docs/SUBMISSION.md`
- `docs/HANDOFF-A.md` (wire contract D1–D5, the `on_report` account order), `docs/LANE-A-TRANSFER.md` (if you also run lane A)
- `docs/HANDOFF-C.md` (circuit, verifying key, fixtures, gateway)
- `docs/EVIDENCE.md` → "Lane B — Solana" (S5 results and CU numbers)

---

## 1. Status

| Item | Tier | State |
|---|---|---|
| S5 (groth16-solana + Poseidon syscall with the template pins; verify lane C's proof in `on_report`; CU) | Phase 0 | **PASS** (localnet). Spend = **112,780 CU** of the ≈191k the receiver gets through CRE's mock forwarder (≈78k headroom). F1 is **not** needed. |
| C1 `brizo_pool`: initialize, deposit, on_report(Spend), large zero-copy accounts | P0 | **Done, 12/12 localnet tests pass.** **Not deployed to devnet yet** (blocked on devnet SOL + the person's go-ahead). |
| E1 `on_report(Settle)` | P1 | **Done and tested** on localnet (pays operator `spends × 0.05 tUSDC`, only for verified spends). Needs a devnet run through `brizo-settle`. |
| `scripts/init-devnet.ts` (mint, faucet authority, large accounts, initialize, writes `deploy/devnet.json` + `deploy/idl/brizo_pool.json`) | P0 | Written, **not run yet** (needs the deploy). |
| `scripts/deposit.ts` (first real deposit) | P0 | Written, not run yet. |
| `deploy/devnet.json` handoff to A, C, D (was due 15:30 SGT) | P0 | **Late. This is the most urgent item.** |
| E12 redeem | P2 | Not started (only after the 17:30 SGT checkpoint passes). |
| E14 receipts root in Settle | P2 | Not started. |

---

## 2. What's in the repo

```
programs/                          Anchor workspace (Anchor 0.31.0, template pins)
  Anchor.toml                      program ids (localnet + devnet), test script
  Cargo.toml, Cargo.lock           Cargo.lock is COMMITTED and has deliberate downgrades (see §4) — keep it
  programs/brizo_pool/src/lib.rs   the program (single file, ~400 lines)
  programs/brizo_pool/src/vk.rs    COPY of circuits/build/verifying_key.rs (lane C) — recopy + rebuild if the key changes (E7 ceremony)
  programs/test_forwarder/         localnet-only stand-in for the CRE forwarder (never deploy it to devnet)
  tests/brizo_pool.ts              mocha tests (anchor test)
  types/circomlibjs.d.ts           typing shim (must stay out of tests/)
scripts/
  init-devnet.ts                   one-shot devnet setup → deploy/devnet.json
  deposit.ts                       mint 10 tUSDC with the faucet authority + deposit(commitment)
  .env.example                     paths only (RPC_URL, ADMIN_KEYPAIR, FAUCET_KEYPAIR, FORWARDER_*)
deploy/                            (empty until init-devnet runs) devnet.json, idl/brizo_pool.json
```

### The program (`programs/programs/brizo_pool/src/lib.rs`)

Accounts:

| Account | Kind | Address | Contents |
|---|---|---|---|
| `Pool` | PDA | `["pool", forwarder_program]` | admin, mint, vault, operator, forwarder_program, tree, leaves, nullifiers, deposit_amount, credits_per_deposit, credit_price, deposits, spends, claimed_spends, redeemed (for E12), bump |
| `Tree` | zero-copy PDA | `["tree", pool]` | next_index, current_root_index, filled_subtrees[10], zeros[10], roots[32] |
| `Leaves` | zero-copy, client-allocated (32,784 B) | keypair | count, leaves[1024][32] (so the app rebuilds the tree without an indexer) |
| `NullifierSet` | zero-copy, client-allocated (131,088 B) | keypair | count, slots[4096][32]; slot = first 4 bytes BE mod 4096, linear probing, all-zero = empty |

Instructions:

| Instruction | Notes |
|---|---|
| `initialize(forwarder_program, deposit_amount, credits_per_deposit, credit_price)` | Creates Pool + Tree, zero-inits Leaves + NullifierSet (allocated in the same tx with `SystemProgram.createAccount`, owner = program), checks the vault is a tUSDC token account owned by the pool PDA and the operator is a tUSDC token account. Requires `credit_price × credits = deposit_amount`. **SPEC deviation:** SPEC's separate `init_large` is folded in here. |
| `deposit(commitment: [u8;32])` | Transfers `deposit_amount` user → vault (hand-built SPL Token CPI, no `anchor-spl`), inserts the leaf (10 Poseidon syscalls), appends to Leaves, pushes the root, emits `Deposited { leaf_index, commitment, root }`. Rejects commitment ≥ r. Accounts: `user (signer), pool (w), tree (w), leaves (w), user_token (w), vault (w), token_program`. |
| `on_report(metadata, report)` | `verify_forwarder_cpi` kept from the template. Borsh `BrizoReport` (exact bytes, trailing bytes rejected). **Spend:** root ≠ 0 and in the last 32 roots → `spends + redeemed < deposits × 200` → decompress A/B/C → `Groth16Verifier::verify()` (rejects inputs ≥ r) → insert nullifier (`NullifierUsed`) → `spends += 1`, emit `Spent`. **Settle:** checks vault/operator/token program keys against Pool, pays `(spends − claimed_spends) × credit_price` vault → operator signed by the pool PDA, emits `Settled { epoch, amount }`. |

Tree conventions (lane C's circuit and `poseidon-vectors.json` match, verified by test): empty leaf = 0, `zeros[i+1] = Poseidon(zeros[i], zeros[i])`, path bit 0 = node is the left child, Poseidon = circomlib `Poseidon(2)` = `sol_poseidon` Bn254X5 big-endian. Public inputs `[root, nullifierHash, requestBinding]`, 32 B big-endian.

Other SPEC deviations (all lane-B-internal; nobody else needs to change anything):
- Pool PDA includes the forwarder program, so a second pool for the real forwarder (E16) can coexist.
- No `vk_hash` in Pool (the key is a constant in the program).
- No `anchor-spl` (keeps the template's dependency pins working); token CPIs and the 165-byte token-account checks are hand-written.

### Contracts with other lanes (all agreed, no objections)

- **Report** (HANDOFF-A D1): `Spend` = variant 0, 225 B: root, nullifier_hash, request_binding (32 B BE each), proof_a 32 (compressed, already negated), proof_b 64, proof_c 32. `Settle` = variant 1 + `epoch: u64` LE.
- **`on_report` accounts** (the workflow hashes the list into the report; the forwarder strips the first two):
  - Spend: `[forwarderState (w), forwarderAuthority, pool (w), tree, nullifiers (w)]`
  - Settle: `[forwarderState (w), forwarderAuthority, pool (w), vault (w), operator (w), token_program]`
- **`deploy/devnet.json`** keys read by lane A's `workflows/scripts/apply-devnet-config.ts`: `programId, pool, tree, nullifiers, vault, operator`, optional `forwarderProgramId, forwarderState, tokenProgram`. `init-devnet.ts` writes all of those plus `leaves, mint, mintDecimals, faucetAuthority, admin, forwarderAuthority, idl, rpcUrl, depositAmount, creditsPerDeposit, creditPrice, initTx`. Lanes C and D need `programId, pool, tree, leaves, nullifiers, vault, mint` and the IDL at `deploy/idl/brizo_pool.json`.
- **Mock forwarder** (all `cre workflow simulate` runs, incl. `--broadcast`): program `7kuEAA3mSC1Tz8gQjnvH7bKFda9xSPRRin9SZbH49cNK`, state `5Tipz3yhTBdVsDbaBxZkrp7Gjf3brGq5SKkxReefPMP7` (from cre-templates `solana-read-write-ts/my-workflow/config.simulation.json` @ d0223f3). These are `init-devnet.ts`'s defaults.

---

## 3. Machine setup (you are on a different machine)

1. **Solana CLI 2.3.0 (Agave)** with platform-tools v1.48 (downloaded on the first build, ~2 GB unpacked — check free disk space; the original machine failed at 1.9 GB free):
   ```bash
   sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.0/install)"
   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
   ```
2. **Anchor CLI 0.31.0** via avm (`cargo install --git https://github.com/coral-xyz/anchor --tag v0.31.0 avm --locked`, then `avm install 0.31.0 && avm use 0.31.0`; add `--from-source` if the binary download times out).
3. **Rust nightly for the IDL** (see §4): `rustup toolchain install nightly-2025-04-15 --profile minimal`.
4. **Node 22/23** + npm: `cd programs && npm install`, `cd scripts && npm install`.
5. **Wallet:** a devnet keypair you control at `~/.config/solana/id.json` (or set `ADMIN_KEYPAIR`). It needs **≈ 4.5 devnet SOL**: program rent 1.56 SOL + an equal temporary buffer (refunded), Leaves + NullifierSet 0.83 SOL, mint/ATAs/fees. Fund via https://faucet.solana.com (the public RPC's airdrop is rate-limited, 429).
6. **Program id (important).** `target/` is gitignored, so the program keypair for `6zTfXoSK41fQwZ4VAbsdnwLADBEQHa8HwcupkfqsZhQ` is **only on the original machine**. Nothing is deployed yet, so either:
   - (a) the person copies `programs/target/deploy/brizo_pool-keypair.json` to you by hand (never via git/chat), or
   - (b) **simplest:** generate a new id on your machine: `cd programs && anchor keys sync`. Then **check `Anchor.toml`**: on the original machine `keys sync` updated `[programs.devnet]` but left `[programs.localnet] brizo_pool` stale — both entries must equal `declare_id!` in `lib.rs`. Commit `lib.rs` + `Anchor.toml`. `test_forwarder`'s id is also regenerated (localnet only, fine).

---

## 4. Build and test (and the traps already hit)

```bash
cd programs
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 1) programs (.so) — NOT plain `anchor build`, its IDL step fails (see below)
NO_DNA=1 anchor build --no-idl

# 2) IDL + TS types, with the pinned nightly
cd programs/brizo_pool && RUSTUP_TOOLCHAIN=nightly-2025-04-15 NO_DNA=1 \
  anchor idl build -o ../../target/idl/brizo_pool.json -t ../../target/types/brizo_pool.ts && cd ../..

# 3) localnet tests (starts solana-test-validator, deploys brizo_pool + test_forwarder)
NO_DNA=1 anchor test --skip-build
```

Expected: `12 passing`, with log lines `deposit … consumed ~21.6k`, `spend … consumed ~112.8k of ~193.5k`, `settle … ~12.8k`. A trailing `Error: No such file or directory (os error 2)` after the results is harmless (Anchor cleanup).

| Trap | Fix already in the repo / what to do |
|---|---|
| Plain `anchor build` → IDL build fails in `proc-macro2 1.0.89` (`proc_macro::SourceFile` missing): Anchor 0.31.0 builds the IDL with `+nightly`, and the template pins `proc-macro2 =1.0.89`, which needs an old nightly | Use the 3-step build above (`RUSTUP_TOOLCHAIN=nightly-2025-04-15`). Do not unpin `proc-macro2`. |
| `anchor-syn`/`anchor-derive-space` 0.31.2 get resolved and use `Span::local_file` (needs newer proc-macro2) | `Cargo.lock` pins both at 0.31.0. Don't `cargo update` blindly. |
| platform-tools' cargo can't parse edition-2024 crates: `zeroize_derive 1.5.0`, `enum-ordinalize(-derive) 4.4.x` | `Cargo.lock` pins `zeroize_derive 1.4.2`, `enum-ordinalize 4.3.0`, `enum-ordinalize-derive 4.3.1`. If a new dep pulls another one: `cargo update -p <crate> --precise <older>`. |
| `solana-program 2.1` no longer re-exports `poseidon` | `solana-poseidon =2.1.21` dependency. |
| `borsh` as a direct dep makes `AnchorDeserialize` derives ambiguous | Template's pin kept under the alias `borsh-pin`. |
| zero-copy accounts need `bytemuck` with `min_const_generics` | `bytemuck =1.23.1` with that feature. |
| Anchor's IDL safety check can't follow `#[path = "../../../../circuits/…"]` | `vk.rs` is a plain copy of `circuits/build/verifying_key.rs`. **Recopy it whenever lane C regenerates keys (E7 ceremony), rebuild, rerun tests, redeploy (upgrade).** |
| Node 22.18+ strips TS types natively and loads tests as ESM (`Named export 'BN' not found`) | `Anchor.toml` test script sets `NODE_OPTIONS=--no-experimental-strip-types`. |
| A `.d.ts` inside `tests/` breaks ts-mocha ("Output generation failed") | Shim lives in `programs/types/`. |
| Coder method names are camelCase | `program.coder.instruction.encode("onReport", …)`. |

---

## 5. Next steps, in order

### P0 — do now (it's past the 15:30 SGT handoff; 17:30 SGT go/no-go)

1. **Ask the person for the go-ahead to deploy to devnet** (CLAUDE.md rule 7) and confirm the wallet is funded (`solana balance -u devnet`).
2. Build (§4 steps 1–2), then deploy:
   ```bash
   cd programs && NO_DNA=1 anchor deploy --provider.cluster devnet -p brizo_pool
   ```
   Record the program id and deploy signature in `docs/EVIDENCE.md` (Lane B section + the "Deployments (devnet)" table). If devnet RPC rate-limits, use a private RPC: `anchor deploy --provider.cluster <url>` and `RPC_URL=<url>` for the scripts.
3. Initialise and write `deploy/devnet.json`:
   ```bash
   cd scripts && cp .env.example .env   # edit paths if needed; never commit .env
   node --env-file=.env --import tsx init-devnet.ts
   ```
   It generates the tUSDC **faucet/mint authority** keypair at `FAUCET_KEYPAIR` (default `~/.config/brizo/faucet-authority.json`) if missing, creates the 6-decimal mint, the vault (ATA of the pool PDA), the operator token account (ATA of the admin wallet), allocates Leaves/NullifierSet and calls `initialize` against the mock forwarder. It refuses to run if `deploy/devnet.json` exists (one pool per program id + forwarder). Record the `initTx` and addresses in EVIDENCE.
4. **First deposit**, using lane C's vector commitment (`Poseidon(123, 456)`):
   ```bash
   node --env-file=.env --import tsx deposit.ts
   ```
   It must be **leaf 0** of the fresh pool: then the printed root equals `root` in `circuits/build/sample-spend-compressed.json` (`076981d9…ef65b9`), and lane C's sample proof verifies on devnet as-is. Record the deposit signature.
5. Commit `deploy/devnet.json` + `deploy/idl/brizo_pool.json` (small commits), merge `lane-b` into `main`, push. Tell lanes A, C, D: devnet.json is live.
6. **Lane A side** (from `workflows/`): `bun run scripts/apply-devnet-config.ts`, then broadcast lane C's compressed sample spend (`workflows/fixtures/spend.sample-compressed.json`) through `brizo-spend` with `--limits "$PWD/limits.simulation.json" --broadcast` → SUCCESS + tx signature (**first spend with an on-chain Groth16 verify via CRE**; record the CU from the explorer logs: `Program 6zTf… consumed N`). Replay the same payload → refusal containing `NullifierUsed` (evidence for "rejected reused credit"). Note: the sample nullifier is consumed by that one spend; further spends need fresh proofs from the gateway/app.
7. **Faucet for the gateway (lane C):** the gateway mints tUSDC with the faucet authority keypair from step 3 and sends 0.02 SOL per request — fund that keypair (or a separate gateway faucet signer) with devnet SOL. Its path goes into `gateway/.env` (never into git).

### P1 (17:30–18:45 SGT)

8. **E1 settle on devnet:** after ≥ 1 real spend, run `brizo-settle` with `--broadcast` (lane A command). Check the operator token account received `spends × 50,000` base units; record the tx. (Operator = admin wallet's tUSDC ATA, address in devnet.json.)
9. Evidence table in `docs/EVIDENCE.md`: program deploy, pool init, deposit, spend, rejected reuse, settle — each with an explorer link (`https://explorer.solana.com/tx/<sig>?cluster=devnet`).

### P2 (only if 17:30 passes; drop anything not half done at 19:30; freeze at 20:30)

10. **E12 redeem (1.5 h, SPEC §11.10).** New direct instruction (not via CRE), submitted by the gateway's relayer:
    - `redeem(root, nullifier_hash, request_binding, proof_a, proof_b, proof_c)` — reuse `verify_credit_proof` + `insert_nullifier` + the root check from `on_report`'s Spend arm (factor them into one helper);
    - the program **recomputes** the binding from the recipient token account key and requires it to equal `request_binding`: `BigUint::from_bytes_be(&hash(recipient.key().as_ref()).to_bytes()) % r` → 32 B BE (`num-bigint` is already in the tree via groth16-solana; `r` = BN254 scalar modulus). That way the relayer can't redirect the payout. Lane C's prover must use the same formula: `sha256(recipient pubkey 32 bytes) mod r`;
    - transfer `credit_price` vault → recipient token account (check mint; pool PDA signs, same seeds as Settle);
    - `redeemed += 1`; the OverSpent check already counts `spends + redeemed`; Settle pays only `spends`;
    - emit `Redeemed { nullifier_hash, recipient }`; add tests (valid redeem with a fresh proof from lane C, wrong recipient → `InvalidProof`, reused nullifier). Lane C must generate a redeem proof whose binding is the recipient hash; lane D the UI. Redeploy = program upgrade (same id).
11. **E14 receipts root (1 h, SPEC §11.12, with lane A).** `BrizoReport::Settle { epoch: u64, receipts_root: [u8; 32] }` (41 B, fits the 120 B default limit). Laziest correct version: **emit** `receipts_root` in `Settled` and don't store it (the tx log is the public record, and Pool's size and Settle's account list stay unchanged). SPEC's "keep the last 32 roots in Pool" would need a bigger Pool, i.e. a re-initialised pool; skip that unless there's time. Coordinate the Borsh change with lane A's `encodeSettleReport` and the gateway's per-epoch Merkle root, then upgrade the program (same id).

### Phase 3 (20:30–22:30 SGT), lane B's share

12. README Solana section: program id, cluster (devnet), pool/tree/mint/leaves/nullifier addresses, explorer links for each tx type, build/test/deploy commands (§4, §5), and honest notes:
    - spends are verified **on-chain** (Groth16 + nullifier), so even a misbehaving forwarder cannot forge a spend; it could only replay Settle, which pays nothing extra;
    - capacity: 1,024 deposits, 4,096 nullifiers (R5 roadmap); root history 32;
    - single-party trusted setup (lane C); unaudited program; upgrade authority is the deployer (R8);
    - templates used: cre-templates `solana-read-write` `kv_store_receiver` (forwarder check + pins); libraries `groth16-solana` 0.2.0, `solana-poseidon`, Anchor 0.31.0.

---

## 6. Rules that still apply

- Never read, print, log or commit `.env`, keypair files or secrets. Scripts may load keypairs to sign; never echo them.
- Ask the person before: devnet/mainnet deploys, spending real funds, `cre workflow deploy`, `cre secrets create`. Devnet txs via simulation are fine.
- **Commits: small and atomic, subject 4–5 words, no body, no `Co-Authored-By` line.**
- Log every command, address and signature in `docs/EVIDENCE.md` → "Lane B — Solana". A feature is "done" only with evidence.
- Shared contracts (`docs/SPEC.md`, report format, account order) change only with the person's approval and lane A/C coordination.

---

## 7. Agent prompt (paste into the new Claude Code session)

```
Using /solana-dev and /chainlink-cre-skill.

You are taking over lane B (Solana) of Brizo at the TOKEN2049 Origins hackathon (Chainlink "Best workflow
with CRE" primary, "Best Use of Solana" secondary). Deadline tonight 7 Oct 2026, 23:59 SGT. All code must be
written during the hackathon. Lane B owns programs/, scripts/, deploy/ and the "Lane B — Solana" section
of docs/EVIDENCE.md. I also own lanes A, C and D now, but keep this session to lane B unless I say otherwise.

Read in full before doing anything: docs/HANDOFF-B.md (your state, commands, traps, next steps — it is
authoritative for lane B), CLAUDE.md, docs/SPEC.md §4.3, §11.10, §11.12, docs/HANDOFF-A.md, docs/HANDOFF-C.md,
docs/PLAN.md (checkpoints), docs/SUBMISSION.md, and the "Lane B — Solana" section of docs/EVIDENCE.md.

State: the brizo_pool Anchor program (initialize, deposit, on_report Spend + Settle) is written and passes
12/12 localnet tests. S5 passed: on-chain Groth16 Spend = 112,780 CU (fits the ~191k through CRE's mock
forwarder). Nothing is deployed to devnet yet; deploy/devnet.json is overdue for lanes A, C and D.

Do, in order:
1. Machine setup per HANDOFF-B §3 (Solana 2.3.0, Anchor 0.31.0, nightly-2025-04-15, npm installs). Decide
   the program id per §3.6 (ask me whether I copied the original keypair; otherwise run anchor keys sync,
   fix both Anchor.toml entries, commit).
2. Build and test exactly as HANDOFF-B §4 (anchor build --no-idl, IDL with the pinned nightly, anchor test
   --skip-build). Expect 12 passing. Don't "fix" Cargo.lock pins.
3. Ask me before deploying. Then: anchor deploy (devnet), scripts/init-devnet.ts, scripts/deposit.ts (must be
   leaf 0 so lane C's sample proof root matches). Commit deploy/devnet.json and deploy/idl/brizo_pool.json,
   merge lane-b into main, push, and give me a short message for lanes A/C/D.
4. Help land evidence: brizo-spend broadcast with workflows/fixtures/spend.sample-compressed.json (SUCCESS),
   replay (NullifierUsed), brizo-settle (operator paid). Record every signature with explorer links.
5. Only after the 17:30 SGT checkpoint passes: E12 redeem, then E14 receipts root, per HANDOFF-B §5, inside
   their time boxes; drop anything not half done at 19:30 SGT; feature freeze 20:30 SGT.
6. Phase 3: the Solana part of the README per HANDOFF-B §5 step 12.

Rules: never read, print or commit .env files, keypairs or secrets; ask before any deploy or spending funds;
small atomic commits with 4–5 word subjects, no body and no Co-Authored-By line; log everything in
docs/EVIDENCE.md under "Lane B — Solana"; stop and ask me if a shared contract in SPEC.md needs to change.

First reply: confirm your lane, list what you read, report the toolchain state on this machine, and start
step 1. Ask if anything blocks you.
```
