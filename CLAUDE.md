# Brizo — project instructions for Claude Code

Brizo lets people and AI agents use frontier AI models privately. The user's raw data stays in the browser, payment uses zero-knowledge credits that can't be traced to a deposit, a Chainlink CRE workflow calls the model from inside a secure enclave with an API key nobody can see, and a Solana program enforces all the money rules.

We are 2 people running 4 Claude Code sessions (lanes A–D, one git worktree each; see `docs/PLAN.md` → Team). Stay inside your lane's directories. We are building this at the TOKEN2049 Origins hackathon for two partner tracks: **Chainlink "Best workflow with CRE"** (primary) and **Solana "Best Use of Solana"** (secondary). The deadline is **Wed 7 Oct 2026, 23:59 SGT**. Every line of code must be written during the hackathon.

## Read these first, in order

1. `docs/SPEC.md` — the architecture, data formats and every component's contract. It is the source of truth.
2. `docs/PLAN.md` — build order, spikes, owners, fallbacks and the cut list.
3. `docs/SUBMISSION.md` — what each track requires and what evidence to collect.

## Skills to use

- `/chainlink-cre-skill` for everything CRE: `cre init`, workflows, triggers, `handlerInTee`, secrets, `SolanaClient.writeReport`, simulation. Follow its routing table and read the reference it names before writing code. Its rules on secrets and simulation are binding here.
- `/solana-dev` for the Anchor program, Solana client code, wallet connection and testing. Where it recommends newer tooling than the CRE Solana template uses (Anchor 1.x, `@solana/kit`), **match the CRE template's pinned versions for the receiver program and the workflow** so the forwarder integration keeps working. Use the skill's guidance freely for the web app.

The official CRE Solana building block is the reference implementation for the receiver program, report encoding and simulation: `smartcontractkit/cre-templates/building-blocks/solana-read-write/solana-read-write-ts`. Start from it rather than from scratch. The confidential starter is `cre init -t hello-confidential-workflows-ts`.

## Toolchain on this machine

| Tool | Version |
|---|---|
| Node | 23.11 (nvm) |
| Bun | installed (`~/.bun/bin/bun`) |
| CRE CLI | v1.37.0 (`~/.cre/bin`; open a new shell or `source ~/.zshrc`) |
| Anchor CLI | 0.32.1 (CRE template pins `anchor-lang = 0.31.0`; use `avm install 0.31.0 && avm use 0.31.0` if the build complains) |
| Solana CLI | 2.3.0 (Agave) |
| circom | 2.2.3 |
| snarkjs | 0.7.6 |
| Ollama | 0.40.0, service on `localhost:11434` with `OLLAMA_ORIGINS="*"`, model `qwen3:8b` (layer 1 of the scrubber) |

The user must run `cre login` themselves (browser, 2FA). Never ask for or handle CRE, Solana or API credentials.

## Hard rules

1. **Secrets.** Never read, print, log or commit `.env`, keypair files, `secrets.yaml` values or API keys. Secrets are referenced by name only (`secrets.yaml` maps names to environment variables). Generate `.env.example` files with placeholder values and add real files to `.gitignore`.
2. **CRE TypeScript runs in QuickJS/WASM, not Node.** No Node built-ins, no `crypto.subtle`, no `fetch`. Use SDK capabilities for I/O, `runtime.now()` for time, and pure-JS libraries (`tweetnacl`, `@noble/hashes`) for crypto. Derive PDAs with `@solana/web3.js` `PublicKey.findProgramAddressSync`, as the template does.
3. **TEE boundary.** Inside `handlerInTee` only: secrets, decrypting the user's envelope, the model call, encrypting the answer. Only non-sensitive derived values may cross back through `usingTheDons()`. Remove enclave logging before any deploy.
4. **Simulate before claiming.** A feature is "done" only when its `cre workflow simulate ... --broadcast` run (or `anchor test`, or a browser run) has actually succeeded and the transaction signature is recorded in `docs/EVIDENCE.md`.
5. **Honest claims.** Do not write anything in the README, UI or slides that the build does not do. The claims we are allowed to make are listed in `docs/SPEC.md` §9.
6. **Scope discipline.** `docs/PLAN.md` lists the full feature backlog in tiers (P0 core, P1 cheap wins, P2 full design, P3 roadmap). Build strictly in tier order, respect each item's time box and the 17:30 and 19:30 checkpoints, and take the listed fallback instead of pushing on. Never start a P2 item while a P0 item is broken. Feature freeze is 20:30.
7. **Ask before irreversible actions:** mainnet anything, `cre workflow deploy`, `cre secrets create`, spending real funds. Devnet transactions through simulation are fine.

## Repository layout

```
brizo/
  CLAUDE.md
  docs/            SPEC.md, PLAN.md, SUBMISSION.md, EVIDENCE.md (create as you go)
  circuits/        credit.circom, build scripts, verifying key exports
  programs/        Anchor workspace for the brizo_pool receiver program
  workflows/       CRE project: project.yaml, secrets.yaml, brizo-spend/, brizo-infer/, brizo-settle/
  gateway/         Bun + Hono service: proof pre-check, CRE orchestration, mailbox, faucet
  app/             Vite + React web app: wallet, deposit, scrubber, prover, privacy diff
  scripts/         init pool, create large accounts, mint test tokens
  sdk/             agent SDK and CLI (P2)
  eval/            quality and leak evaluation (P1)
  deploy/          devnet.json with every deployed address
  spikes/          throwaway Phase 0 experiments
```

## Everyday commands

```bash
# CRE
cre whoami
cre workflow simulate ./brizo-spend --target simulation-settings --non-interactive --trigger-index 0 --http-payload ./fixtures/spend.json --broadcast
cre workflow simulate ./brizo-infer --target simulation-settings --non-interactive --trigger-index 0 --http-payload ./fixtures/infer.json
cre workflow simulate ./brizo-settle --target simulation-settings --non-interactive --trigger-index 0 --broadcast

# Solana
solana config set --url devnet
anchor build && anchor deploy --provider.cluster devnet

# Circuits
circom circuits/credit.circom --r1cs --wasm --sym -o circuits/build
snarkjs groth16 setup circuits/build/credit.r1cs <ptau> circuits/build/credit_0000.zkey
```

Check exact CRE flags against `/chainlink-cre-skill` (`references/simulation.md`, `references/cli-reference.md`) before relying on the lines above.

## Definition of done for the hackathon

- A judge can open the hosted app, get test tokens from the faucet, deposit, ask a question, see the privacy diff, and receive an answer.
- Evidence exists for each workflow simulation and each Solana transaction type (deposit, spend, rejected reused credit, settle).
- README explains setup, simulation commands, the threat model and the honest limits.
