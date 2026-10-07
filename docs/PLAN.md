# Brizo — build plan (CRE + Solana), full feature set

All times are SGT on Wed 7 Oct 2026. Submission closes at **23:59**. Aim to submit by **23:30**.

This plan lists **every** feature of the full design. We build in tier order and cut by the clock at fixed checkpoints, never by mood. Specs for P1 and P2 features are in `SPEC.md` §11.

## Team: 2 people, 4 work lanes

The work is split into four lanes (A–D). Each person owns two lanes and runs **one Claude Code session per lane**, in parallel, each in its own git worktree, so agents never edit the same files. The person reviews, answers questions, and runs anything needing a login or key.

| Person | Lanes | Owns | Why this split |
|---|---|---|---|
| **Person 1 — Chain** | **A — CRE** and **B — Solana** | `workflows/`, `programs/brizo_pool`, deploy/init scripts, `deploy/devnet.json`, CRE and devnet evidence | The Borsh report written by the workflows and the `on_report` that reads it must change together |
| **Person 2 — Client** | **C — ZK + gateway** and **D — App** | `circuits/`, `gateway/`, `app/`, `sdk/`, `eval/`, test token, faucet | The circuit, prover, gateway and app share one request format end to end |

Lanes and their directories:

| Lane | Directory | Session focus |
|---|---|---|
| A | `workflows/` | brizo-spend, brizo-infer, brizo-settle |
| B | `programs/`, `scripts/` | brizo_pool program, deployment |
| C | `circuits/`, `gateway/`, `sdk/`, `eval/` | Circuit, gateway, agent SDK, evaluation |
| D | `app/` | Web app, scrubber, privacy diff |

Set up the worktrees once:

```bash
cd ~/Desktop/brizo
git add -A && git commit -m "docs: Brizo spec, plan and agent kit"
git worktree add ../brizo-A -b lane-a && git worktree add ../brizo-B -b lane-b
git worktree add ../brizo-C -b lane-c && git worktree add ../brizo-D -b lane-d
```

Merge each lane into `main` at every handoff below (lanes touch different directories, so merges should be clean).

### Handoffs between the two people

| Time | From → To | What | Why |
|---|---|---|---|
| ~13:00 | Person 2 (C) → Person 1 (B) | `circuits/build/verification_key.json`, the Rust verifying key, and one sample proof + public inputs as a JSON fixture | The program needs them for spike S5 and the `Spend` verifier |
| ~13:30 | Person 1 (A) → Person 2 (C) | Exact `cre workflow simulate` commands and payload JSON shapes for brizo-spend and brizo-infer | The gateway calls them |
| ~15:30 | Person 1 (B) → Person 2 (C, D) | `deploy/devnet.json` (program ID, Pool PDA, tUSDC mint, Leaves, NullifierSet, vault) and the program IDL | The app deposits and the gateway reads accounts |
| ~15:30 | Person 2 (C) → Person 1 (A) | The enclave box public key and the request-binding formula, as implemented | brizo-infer checks the binding and decrypts |
| 17:00 | Both | Run one question end to end from the command line together | Rehearses the 17:30 checkpoint |

### Who does what in Phase 3 (story)

| Person 1 | Person 2 |
|---|---|
| README technical sections (architecture, commands, addresses, explorer links), `docs/EVIDENCE.md`, the CRE evidence field, the Solana submission details | Slides (.key/.ppt), demo recording on the Ollama machine, the 3-minute video, the write-up, the "Limits and roadmap" slide, final link checks |

## Tiers

| Tier | Meaning | Rule |
|---|---|---|
| **P0** | The product does not work without it | Never cut. If P0 slips, everything else waits. |
| **P1** | Cheap, high value for judges | Build right after P0 works end to end |
| **P2** | Full-design features | Start only after the 17:30 checkpoint passes; each has a hard time box; abandon at the end of the box |
| **P3** | Roadmap only | Not buildable in 12 hours. Explain in the README and the "Limits and roadmap" slide. |

## Full feature backlog

| ID | Feature | Tier | Owner | Box | Depends on | Spec |
|---|---|---|---|---|---|---|
| C1 | `brizo_pool` program: initialize, large accounts, deposit, on_report Spend (on-chain Groth16, nullifier set) | P0 | B | Phase 1 | S5 | §4.3 |
| C2 | `brizo-spend` workflow (HTTP trigger → Solana `writeReport`) | P0 | A | Phase 1 | S2, C1 | §4.4 |
| C3 | `brizo-infer` workflow (`handlerInTee`, model call, encrypted answer) | P0 | A | Phase 1 | S1, S4, S6 | §4.4 |
| C4 | Circuit, trusted setup, verifying keys | P0 | C | Phase 1 | S7 | §4.2 |
| C5 | Gateway: ask, mailbox, answer, config, faucet (tUSDC) | P0 | C | Phase 1 | C2, C3 | §4.5 |
| C6 | App: connect, faucet, deposit, profile, ask, answer | P0 | D | Phase 1–2 | C4, C5 | §4.6 |
| C7 | Two-layer scrubber (Ollama rewrite, then rules + leak check; rules-only fails closed) and privacy diff | P0 | D | Phase 1 | S8 | §5 |
| C8 | Evidence log, README, slides, video | P0 | All / D | Phase 3 | — | SUBMISSION.md |
| E1 | `brizo-settle` workflow + Settle instruction | P1 | A + B | 45 min | C1 | §4.3, §4.4 |
| E2 | "Reuse this credit" button showing on-chain `NullifierUsed` | P1 | D | 20 min | C6 | §4.6 |
| E3 | Random 2–20 s delays between sub-requests, with countdown | P1 | D | 15 min | C6 | §11.1 |
| E4 | Quality and leak evaluation (20 synthetic profiles) | P1 | C | 1.5 h | C7 | §11.2 |
| E5 | Encrypted note backup and restore | P1 | D | 30 min | C6 | §11.3 |
| E6 | Gateway rate limiting, mailbox delete-on-read and expiry | P1 | C | 20 min | C5 | §11.4 |
| E7 | Three-party trusted-setup ceremony (each teammate contributes) | P1 | C | 20 min | C4 | §11.5 |
| E8 | "Limits and roadmap" README section and slide | P1 | D | 20 min | — | §11.6 |
| E9 | x402 top-up for agents | P2 | C | 2 h | C5 | §11.7 |
| E10 | Agent SDK / CLI (prove, encrypt, ask; spending cap; optional Tor) | P2 | C | 1.5 h | C5 | §11.8 |
| E11 | Gateway as a Tor onion service, and per-request Tor isolation in the SDK | P2 | C | 45 min | C5, E10 | §11.9 |
| E12 | Redeem unused credits to a fresh address (`redeem` instruction) | P2 | B + D | 1.5 h | C1, C4 | §11.10 |
| E13 | WebLLM in-browser model for judges (no install) | P2 | D | 1.5 h | C7 | §11.11 |
| E14 | Privacy receipts: salted per-epoch log root in Settle | P2 | A + B | 1 h | E1 | §11.12 |
| E15 | Single atomic TEE workflow (infer then write spend from the enclave handler) | P2 | A | 1 h | S3 | §11.13 |
| E16 | Initialise against the real devnet forwarder and attempt `cre workflow deploy` | P2 | A | 1 h | Deploy access granted | §11.14 |
| E17 | Multiple model providers selectable by config | P2 | A | 30 min | C3 | §11.15 |
| R1 | Enclave-generated keys nobody can see | P3 | — | — | CRE feature | §11.16 |
| R2 | Independent security audit, circuit review, fuzzing | P3 | — | — | — | |
| R3 | Multi-party public trusted-setup ceremony | P3 | — | — | — | |
| R4 | Several independent relays/gateways with discovery | P3 | — | — | — | |
| R5 | Deeper tree, several trees, compressed nullifier accounts | P3 | — | — | — | |
| R6 | Mainnet with real USDC | P3 | — | — | — | |
| R7 | Mobile app | P3 | — | — | — | |
| R8 | Freeze program upgrade authority or move it to a multisig | P3 | — | — | After judging | |
| R9 | Exact token accounting per credit instead of a character cap | P3 | — | — | — | |
| R10 | Cardano/Masumi port (agent registry, escrow) | P3 | — | — | Separate track | |

## Schedule and checkpoints

### Phase 0 — spikes (11:30 → 13:30)

Each spike answers one question with a tiny throwaway project in `spikes/`. Record pass/fail plus one line in `docs/EVIDENCE.md`.

| # | Owner | Question | Pass condition | If it fails |
|---|---|---|---|---|
| S1 | A | Does a `handlerInTee` workflow with an HTTP trigger simulate locally? | `cre init -t hello-confidential-workflows-ts`, swap in an HTTP trigger, `cre workflow simulate ... --http-payload` succeeds | F2 |
| S2 | A | Does the Solana building block's golden path work for us? | Template simulation with `--broadcast` produces a devnet tx signature | Ask in the Chainlink Discord or at the booth; this is the backbone |
| S3 | A | Can one TEE handler call `usingTheDons()` and then `SolanaClient.writeReport`? | A write lands from inside a TEE handler | E15 is dropped; the two-workflow design stays |
| S4 | A | Do `tweetnacl` and `@noble/hashes` run inside a CRE TS workflow (QuickJS)? | Box/open round trip and `sha256` correct in simulation | F3 |
| S5 | B | Do `groth16-solana` + `solana-poseidon` build with the template's pins, and does verification fit the compute budget through the forwarder? | `anchor build` passes; a snarkjs proof verifies in `on_report` via `brizo-spend` with `computeConfig` ≈ 1,000,000; Poseidon test vector matches circomlibjs | F1 |
| S6 | A | Can the TEE handler call the model API in simulation? | A real answer comes back using `MODEL_API_KEY` from the environment | F2 |
| S7 | C | Does the circuit compile, prove and verify in Node? | Depth 10, proof < 5 s, verify OK, Rust verifying key exported | Depth 8 |
| S8 | D | Can the browser app call local Ollama and get valid JSON? | `POST http://localhost:11434/api/chat`, `qwen3:8b`, `format: "json"` → `{subQuestions, removed}` for 3 sample profiles, < 15 s each | `qwen3:4b`; JSON-schema `format`; worst case rules-only, labelled |

Also in Phase 0: A runs `cre account access` to check or request deploy access (needed only for E16).

### Phase 1 — P0 core (13:30 → 17:30)

| Owner | P0 items | Done when |
|---|---|---|
| B | C1 | Tests cover deposit, valid spend, reused nullifier, unknown root, invalid proof; deployed to devnet; initialised against the simulator mock forwarder; addresses in `deploy/devnet.json` |
| A | C2, C3 | Both simulate; spend broadcasts a real devnet tx; infer returns an encrypted answer to a test mailbox |
| C | C4, C5 | `curl` drives one question end to end from the command line |
| D | C6 (screens 1–4), C7 | Deposit lands from the browser; privacy diff correct for 3 sample profiles in both scrubber modes |

**Checkpoint 17:30 (go/no-go):**
- **Pass** (one question works end to end): do P1, then P2 lanes.
- **Fail:** no P2 at all. Everyone helps finish P0. Only E3 and E8 from P1.

### Phase 2 — P1, then P2 lanes (17:30 → 20:30)

1. **17:30 → 18:45: P1 and integration.**

   | Owner | Items |
   |---|---|
   | A + B | E1 settle |
   | D | C6 screens 5–6, E2, E3, E5 |
   | C | E4 (runs in the background), E6, E7 |
   | D | E8 (draft) |

   Hosting: app on Vercel/Netlify; gateway on one teammate's laptop behind `cloudflared tunnel`, kept awake until judging ends.

2. **18:45 → 20:30: P2 lanes.** Start an item only when every P1 item of that owner is done. Work in the order listed, stop each at its time box, and abandon unfinished items without regret.

   | Person | Lane | Order |
   |---|---|---|
   | 1 | A (CRE) | E15 (only if S3 passed) → E17 → E16 (only if deploy access is granted) → E14 with B |
   | 1 | B (Solana) | E12 → E14 with A |
   | 2 | C (gateway/agents) | E10 → E9 → E11 |
   | 2 | D (app) | E13 → E12 UI |

   **Two-person limit:** with only two people reviewing four agent sessions, each lane realistically lands one or two P2 items. Priority across the whole team, by judging value:
   1. E10 + E9 (agents paying with x402: a listed CRE use case)
   2. E12 (redeem: more on-chain logic for Solana)
   3. E15 (atomic TEE workflow)
   4. E13 (WebLLM for judges)
   5. E11 (Tor)

   Everything else is likely roadmap.

**Checkpoint 19:30:** any P2 item not at least half done is dropped now.

**20:30: feature freeze.** Only bug fixes after this. Everything not finished moves to the "Limits and roadmap" slide (E8).

### Phase 3 — story (20:30 → 22:30)

- `README.md` per `docs/SUBMISSION.md`, including the limits and roadmap section.
- Slides (.key or .ppt) with the embedded screen recording.
- Demo video ≤ 3 minutes (SPEC §8). Record on a machine with Ollama running.
- Write-up: problem, technical approach, path to production.
- Paste the E4 numbers into the slides; leave placeholders only if E4 genuinely didn't finish, and say so.

### 22:30 → 23:30 — buffer and submit

Test every link from a logged-out browser. Submit to the main track first, then CRE (paste evidence), then Solana.

## Fallbacks

| ID | Trigger | Fallback |
|---|---|---|
| F1 | S5 fails | Direct `spend` instruction that verifies the proof, submitted by the gateway's relayer key (the user's wallet never signs a spend). CRE keeps `brizo-infer` and `brizo-settle`. Update the claims. |
| F2 | S1/S6 fail | Normal handler + `ConfidentialHTTPClient` for the model call (API key still protected) |
| F3 | S4 fails | Try `@noble/ciphers` + `@noble/curves`; last resort TLS only, and the README says the gateway sees the scrubbed question. Never send unscrubbed data. |
| F4 | Browser proving too slow | Pre-generate proofs right after deposit, in a Web Worker |

## Local model setup (layer 1 of the scrubber)

Done on the main dev machine: Ollama 0.40.0 as a Homebrew service, browser origins allowed, `qwen3:8b` pulled. On another teammate's Mac:

```bash
brew install ollama
launchctl setenv OLLAMA_ORIGINS "*"     # lets the browser app call localhost:11434; tighten later
brew services start ollama
ollama pull qwen3:8b
```
