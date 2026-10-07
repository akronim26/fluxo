# Prompts for Claude Code (2 people, 4 sessions)

Each person runs two Claude Code sessions, one per lane, each opened in its own worktree (`~/Desktop/brizo-A` … `brizo-D`; see `PLAN.md` → "Team"). Every worktree contains `CLAUDE.md` and `.claude/skills/`, so `/chainlink-cre-skill` and `/solana-dev` work in all four.

| Person | Session 1 | Session 2 |
|---|---|---|
| Person 1 — Chain | Lane A — CRE (`~/Desktop/brizo-A`) | Lane B — Solana (`~/Desktop/brizo-B`) |
| Person 2 — Client | Lane C — ZK + gateway (`~/Desktop/brizo-C`) | Lane D — App (`~/Desktop/brizo-D`) |

Each prompt below is self-contained. Paste the **shared preamble** first, then the lane block, as one message.

## Shared preamble (start of every session)

```text
Using /chainlink-cre-skill and /solana-dev.

We're building "Brizo" at the TOKEN2049 Origins hackathon for the Chainlink "Best workflow with CRE"
track (primary) and "Best Use of Solana" (secondary). Deadline: tonight, Wed 7 Oct 2026, 23:59 SGT.
All code must be written during the hackathon. We are 2 people running 4 Claude Code sessions,
one per lane, each in its own git worktree. You are ONE of those sessions: stay inside your lane's
directories and never edit another lane's files. Shared contracts between lanes are in
docs/SPEC.md; if you need a contract changed, stop and tell me instead of changing it.

Read in full before doing anything: CLAUDE.md, docs/SPEC.md, docs/PLAN.md (especially "Team",
the backlog, the spikes and the handoffs), docs/SUBMISSION.md.

Environment: CRE CLI v1.37.0 (~/.cre/bin), circom 2.2.3, snarkjs 0.7.6, Anchor CLI 0.32.1,
Solana CLI 2.3.0, Bun, Node 23, Ollama 0.40.0 on localhost:11434 with qwen3:8b. Reference
implementation for the Solana receiver, report encoding and simulation:
smartcontractkit/cre-templates/building-blocks/solana-read-write/solana-read-write-ts.

Rules: never read, print or commit .env files, keypairs or secret values; create .env.example
and I'll fill in real values. Ask before any deploy, `cre secrets create`, or mainnet action.
Devnet transactions via `cre workflow simulate --broadcast` are fine once I've funded the key.
Build in tier order (P0 → P1 → your P2 lane), respect the time boxes and the checkpoints
(17:30 go/no-go, 19:30 drop half-done P2, 20:30 feature freeze). Log every spike result,
command and transaction signature in docs/EVIDENCE.md under your lane's heading. Commit small
and often on your lane's branch. Never claim anything in docs or UI without evidence.

First reply: confirm your lane, summarise your lane's P0/P1/P2 items and handoffs in 10 lines or
fewer, list anything in SPEC.md that looks wrong or risky for your lane (checked against the
skills' references), then start your spikes. Ask before you start if anything blocks you.
```

## Lane A — CRE (Person 1, session 1, `~/Desktop/brizo-A`)

```text
Your lane: A — CRE. You own workflows/ only (SPEC §4.4, §11.13–11.15).
Spikes, in order: S2 (clone the solana-read-write building block into spikes/s2 and run its
golden-path simulation with --broadcast), S4 (tweetnacl + @noble/hashes round trip inside a
hello-confidential-workflows-ts project), S1 (handlerInTee with an HTTP trigger in simulation),
S6 (model API call from the TEE handler), S3 (can a TEE handler cross back with usingTheDons()
and then SolanaClient.writeReport?). Read references/simulation.md, project-scaffolding.md and
confidential-workflows.md before running cre commands. Also run `cre account access` and report.
P0: brizo-spend (HTTP trigger → Solana writeReport of BrizoReport::Spend, raised computeConfig)
and brizo-infer (handlerInTee, HTTPClient + TeeRuntime, binding check, nacl box open/seal,
POST to mailbox, only non-sensitive values cross back). Reuse the template's report encoding
and forwarder account order. Write fixtures/ for each workflow.
P1: brizo-settle (cron → BrizoReport::Settle), with lane B.
P2 lane in order: E15 (only if S3 passed) → E17 → E16 (only if deploy access) → E14 with lane B.
Handoffs: at ~13:30 give lane C the exact simulate commands and payload shapes (write them to
docs/HANDOFF-A.md). Read program addresses from deploy/devnet.json (lane B) once it exists.
```

## Lane B — Solana (Person 1, session 2, `~/Desktop/brizo-B`)

```text
Your lane: B — Solana. You own programs/ and scripts/ only (SPEC §4.3, §11.10, §11.12).
Spike S5: start from the template's kv_store_receiver, keep verify_forwarder_cpi and its
dependency pins, add groth16-solana and the Poseidon syscall, confirm `anchor build`, check a
Poseidon test vector against circomlibjs, and verify the sample proof from lane C
(circuits/build fixtures, arriving ~13:00) inside on_report. Measure compute units.
If anchor 0.32.1 conflicts with the 0.31.0 pins, use avm to switch.
P0: brizo_pool with Pool, Tree (depth 10, 32-root history), Leaves and NullifierSet (large
zero-copy accounts allocated client-side), and the instructions initialize, init_large, deposit and
on_report(Spend). Tests: deposit, valid spend, reused nullifier, unknown root, invalid proof.
Scripts: create the tUSDC mint (6 decimals) and faucet authority, allocate the large accounts,
initialise against CRE's simulator mock forwarder (values from the template's
config.simulation.json). Deploy to devnet (ask me first) and write every address plus the IDL
path to deploy/devnet.json by ~15:30.
P1: Settle variant in on_report, with lane A.
P2 lane in order: E12 (redeem instruction) → E14 (receipts root in Settle) with lane A.
If S5 fails (compute too high through the forwarder CPI), apply fallback F1 from PLAN.md and tell me.
```

## Lane C — ZK + gateway (Person 2, session 1, `~/Desktop/brizo-C`)

```text
Your lane: C — ZK + gateway. You own circuits/, gateway/, sdk/ and eval/ only
(SPEC §4.2, §4.5, §11.2, §11.4, §11.5, §11.7–11.9).
Spike S7 first, fast, because lane B is waiting: credit.circom (circom 2.2.3 + circomlib, BN254,
Poseidon, depth 10, public inputs [root, nullifierHash, requestBinding]), setup with a public
Powers of Tau file, prove and verify in Node, export verification_key.json and the Rust
verifying key for groth16-solana (follow its README for byte order and negating proof_a), plus
one sample proof fixture. Hand these to lane B by ~13:00 in circuits/build/ and describe them in
docs/HANDOFF-C.md.
P0: gateway (Bun + Hono): /api/faucet, /api/ask (snarkjs pre-verify → brizo-spend simulation
with --broadcast → only on success brizo-infer simulation; one request at a time), /mailbox/:id,
/api/answer/:id, /api/config. Generate the enclave box keypair (public key in config; the secret
key is set by me in .env, never printed) and hand the public key and binding formula to lane A
by ~15:30. Use lane A's commands from docs/HANDOFF-A.md and lane B's deploy/devnet.json.
P1: E4 evaluation (20 synthetic profiles; run it in the background), E6 gateway hardening,
E7 three-party ceremony (I'll ask my teammate to contribute).
P2 lane in order: E10 agent SDK/CLI → E9 x402 top-up (verify current x402 Solana packages first)
→ E11 Tor onion service.
```

## Lane D — App (Person 2, session 2, `~/Desktop/brizo-D`)

```text
Your lane: D — App. You own app/ only (SPEC §4.6, §5, §11.1, §11.3, §11.11).
Spike S8: from a Vite dev server, call http://localhost:11434/api/chat with qwen3:8b and
format "json" and get {subQuestions, removed} for three sample profiles in under 15 s each.
P0: Vite + React app. Screens: connect + faucet; deposit (circomlibjs Poseidon commitment, note
in localStorage); profile + question; privacy diff with the two-layer scrubber (Ollama rewrite,
then deterministic rules and the leak check; rules-only mode fails closed) and the
scrubber-mode badge; ask (snarkjs fullProve in a Web Worker using lane C's circuit files,
nacl.box to the enclave key from /api/config, poll the gateway); answer (decrypt, evaluate
branches, show the branch used and transaction links). Scrubber rules: never infer sex from a
name, never invent dates, lab bands from a reference table with its source cited, travel
direction computed correctly. Until deploy/devnet.json and the gateway exist, build against
mocks behind a flag.
P1: E2 "reuse this credit" button, E3 random 2–20 s delays with countdown, E5 encrypted note
backup and restore.
P2 lane in order: E13 WebLLM in-browser model → E12 redeem UI (after lane B ships redeem).
Then, in Phase 3, help me with the slide outline and the 3-minute video script from SPEC §8.
```

## Status check (paste into any session at 17:30, 19:30 and 20:30)

```text
Compare the repo against the backlog in docs/PLAN.md for YOUR lane and report each item as done
(with evidence in docs/EVIDENCE.md), in progress, not started, or blocked. Apply the checkpoint
rule for the current time: 17:30 go/no-go for P2; 19:30 drop any P2 item not at least half done;
20:30 feature freeze. Tell me exactly what to drop, and add every dropped item to the "Limits and
roadmap" list. List any claims in docs or UI for your lane that lack evidence.
```
