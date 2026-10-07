# Brizo — submission checklist

Deadline: **12:00 am on 8 Oct = submit by 23:59 SGT on 7 Oct.** No late entries; slides lock at submission.

## Main track (every team submits here first)

- [ ] GitHub repository: public, or judge access granted
- [ ] Project link: live URL or hosted demo
- [ ] Presentation slides: Google Drive link to a .ppt or .keynote file (Google Slides, Gamma or web links are not accepted)
- [ ] Demo footage embedded in the slides as a screen recording (live demos are not allowed on stage; no YouTube links)

Main-track judging: functionality and execution 30%, technical implementation and integration 25%, innovation 20%, usefulness and impact 15%, demo and presentation 10%.

## Chainlink — Best workflow with CRE ($2,000 × top 5)

To qualify:
- [ ] A CRE Workflow used as an orchestration layer in the project: brizo-spend, brizo-infer and brizo-settle
- [ ] At least one blockchain integrated with an external API, LLM or AI agent: Solana devnet + the model API
- [ ] A successful simulation (CRE CLI) or live deployment

Because we use Confidential Workflows, the workflow must also:
- [ ] register and use a TEE handler (`handlerInTee`);
- [ ] process at least one sensitive input, secret or confidential response inside the enclave (the model API key, the decrypted question, the model answer);
- [ ] be meaningfully integrated, not a placeholder;
- [ ] show a successful Confidential Workflow simulation;
- [ ] include evidence: terminal output, execution logs or video.

Submission fields: GitHub repo, project link, slides, **evidence of a successful CRE simulation or deployment** (paste the simulate commands, outputs and transaction signatures from `docs/EVIDENCE.md`).

Judging: blockchain 40%, effective use of CRE 40%, wow factor 20%.

## Solana — Best Use of Solana ($5,000 / $3,000 / $2,000)

To qualify:
- [ ] Interacts with Solana through a program we deployed (`brizo_pool`); reading on-chain data alone doesn't count
- [ ] Functional on devnet; README lists the program ID and cluster
- [ ] At least one example transaction link from Solana Explorer or Solscan (include deposit, spend, rejected reuse, settle)
- [ ] All code written during the hackathon; any pre-existing work disclosed in the README (templates and libraries used: name them)
- [ ] Public GitHub repository, or judge access granted
- [ ] A working demo a judge can run end to end without assistance (hosted app + faucet)

Judging: technical execution on Solana 30% (core logic on-chain scores higher), innovation 20%, product and UX 20%, real-world impact 15%, demo and presentation 15%.

## README must contain

1. One-paragraph pitch and the three leaks Brizo closes
2. Architecture diagram (SPEC §3) and the "who sees what" table (SPEC §2)
3. How the CRE workflows and the Solana program divide the work
4. Setup: prerequisites, `.env.example` files, install commands
5. Exact commands: program build and deploy, the three `cre workflow simulate` commands, gateway and app start
6. Deployed addresses: program ID, pool PDA, tUSDC mint, cluster
7. Explorer links for each transaction type
8. Honest limits (SPEC §2) and what production would change
9. Hackathon statement: built during TOKEN2049 Origins; list the templates used (CRE `solana-read-write` building block, `hello-confidential-workflows`) and the libraries

## Evidence to capture (in `docs/EVIDENCE.md`)

| Item | Command or source | Signature or log |
|---|---|---|
| Spikes S1–S7 | — | pass/fail + one line each |
| Program deploy | `anchor deploy` | program ID, tx |
| Pool initialise | init script | tx |
| Deposit | app or script | tx |
| Spend (proof verified on-chain) | `cre workflow simulate ./brizo-spend ... --broadcast` | tx + simulate output |
| Reused credit rejected | same payload replayed | simulate output with `NullifierUsed` |
| TEE model call | `cre workflow simulate ./brizo-infer ...` | simulate output (no secrets) |
| Settle | `cre workflow simulate ./brizo-settle ... --broadcast` | tx |
