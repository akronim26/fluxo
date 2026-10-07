# Brizo — technical specification (CRE + Solana build)

Status: hackathon build, 7 Oct 2026. Items marked **[VERIFY]** are assumptions to confirm in the spikes in `PLAN.md` before building on them.

## 1. Product

People and agents want frontier AI help on private matters. Every request normally identifies the asker three ways: what they write, how they pay, and where they connect. Brizo closes all three:

| Leak | Brizo's fix | Where it runs |
|---|---|---|
| What you write | Two-layer scrubber on the user's device: a local model (Ollama, or WebLLM in the browser) rewrites, splits and neutralises the style of the question; deterministic rules then generalise structured fields and block sending if any known personal value survived. The frontier model returns a branched answer that the browser fills in with the real values. | Browser + local model |
| How you pay | Zero-knowledge credits. Deposit 10 tUSDC once and get 200 credits at 0.05 each. Each spend is a Groth16 proof that "I own some unspent deposit" plus a one-time nullifier. | Browser (prove), Solana program (verify) |
| Who sees the request in transit | The scrubbed question is encrypted to the CRE enclave's key. The model call happens inside a CRE Confidential Workflow, with the API key released only inside the enclave. | CRE TEE |

The Solana program holds the deposits, verifies every spend proof on-chain, rejects reused credits, and pays the operator only for verified spends.

## 2. Who sees what (threat model)

| Observer | Sees | Does not see |
|---|---|---|
| Model provider (via OpenRouter) | A generic question coming from the CRE enclave's account. OpenRouter, as the intermediary, sees the same. | The user's identity, raw data, wallet, IP |
| Gateway (our server) | User IP, ciphertext, the ZK proof, timing | Plaintext question or answer, which deposit paid |
| CRE node operators | Workflow code, triggers, chain writes, the proof and nullifier | Decrypted question, model answer, API key (stay inside the enclave) |
| Our team | Same as the gateway. Because we generated the enclave's box key and uploaded it as a CRE secret, we *could* decrypt intercepted scrubbed questions. | Raw data, which never leaves the browser |
| Anyone reading Solana | Deposits (wallet + amount), nullifiers, settlement amounts | Which deposit paid for which request |

Honest limits to state in the README:
- The anonymity set is everyone who deposited. With few users, privacy is weak.
- Content scrubbing is best-effort. The local model can miss a detail, and the rules only guarantee that *known* profile values don't leave. In rules-only mode (no local model), the user's writing style still leaves the device.
- The gateway sees the user's IP. A user can open the app through Tor Browser; the hosted demo does not enforce it.
- Trust in the enclave is trust in the TEE hardware (AWS Nitro) and in the published workflow code.
- In the hackathon the CRE workflows run in the CRE simulator, called by the gateway. Production would deploy them to a DON (Confidential Workflows deployment is private beta).

## 3. Architecture

```
Browser app
  1  faucet ──────────────► gateway /api/faucet (mints tUSDC, sends a little devnet SOL)
  2  deposit(commitment) ──► Solana: brizo_pool.deposit         (user signs)
  3  scrub question locally, show privacy diff
  4  prove credit (snarkjs, in browser), encrypt question to enclave key
  5  POST /api/ask ────────► gateway
                              a. verify proof off-chain (cheap pre-check)
                              b. CRE brizo-spend  (HTTP trigger, normal handler)
                                   └─ SolanaClient.writeReport(Spend) ─► forwarder ─► brizo_pool.on_report
                                        Groth16 verify on-chain, insert nullifier, count spend
                              c. only if b succeeded: CRE brizo-infer (HTTP trigger, handlerInTee)
                                   └─ in enclave: open envelope, check binding, call model,
                                      encrypt answer to user key, POST to gateway mailbox
  6  poll /api/answer/:id ─► gateway returns ciphertext → browser decrypts, fills branches

CRE brizo-settle (cron) ─► SolanaClient.writeReport(Settle) ─► brizo_pool.on_report pays operator
```

Two separate workflows (spend, then infer) is the primary design because both halves use capabilities proven in Chainlink's own templates. A single TEE workflow that writes to Solana after the model call is a stretch goal, gated on spike S3 in `PLAN.md`.

## 4. Components

### 4.1 Numbers used everywhere

| Constant | Value |
|---|---|
| Test token | `tUSDC`, our own SPL mint, 6 decimals |
| Deposit | exactly `10_000_000` base units (10 tUSDC) |
| Credits per deposit | 200 |
| Credit price | `50_000` base units (0.05 tUSDC) |
| Request cap | ≤ 4,000 input tokens (enforce ≤ 12,000 characters), `max_tokens = 2000` |
| Merkle depth | 10 (1,024 deposits) |
| Root history | last 32 roots |
| Nullifier set capacity | 4,096 (power of two) |

### 4.2 Circuit `circuits/credit.circom`

Curve BN254, hash Poseidon from circomlib (it matches Solana's `sol_poseidon` syscall and the `light-poseidon` crate; confirm with a test vector, **[VERIFY]** S5).

```
template Credit(depth = 10)
  private inputs: secret, nk, pathElements[depth], pathIndices[depth], i
  public inputs:  root, nullifierHash, requestBinding
  constraints:
    commitment    = Poseidon(2)(secret, nk)
    MerkleProof(depth)(leaf = commitment, pathElements, pathIndices) == root
    i < 200                       (LessThan(8))
    nullifierHash = Poseidon(2)(nk, i)
    requestBinding * requestBinding === requestBinding * requestBinding   (binds the public input)
```

- `requestBinding = sha256(requestId ‖ ciphertext) mod r` (BN254 scalar field), so a proof can't be reused for a different request.
- Trusted setup: use a public Powers of Tau file (Hermez/iden3 `powersOfTau28_hez_final_12.ptau` or larger) plus one local contribution. Say in the README that this is a single-party phase 2 setup.
- Exports:
  - `credit.wasm` and `credit_final.zkey` for the browser;
  - `verification_key.json` for the gateway;
  - a Rust verifying key for the program, using `groth16-solana`'s conversion script.
- snarkjs proof points need byte-order conversion and negation of `proof_a` before `groth16-solana` will accept them. Follow that crate's README exactly.

### 4.3 Solana program `programs/brizo_pool` (Anchor, receiver for the CRE forwarder)

Start from the template's `kv_store_receiver`. Keep its `verify_forwarder_cpi` logic: the forwarder `state` account must be owned by the recorded forwarder program, and `forwarder_authority` must equal the PDA `["forwarder", state, program_id]` under the forwarder program.

**Accounts**

| Account | Type | Fields |
|---|---|---|
| `Pool` | PDA `["pool"]` | `admin`, `mint`, `vault` (token account owned by the pool PDA), `operator` (payout token account), `forwarder_program`, `credit_price`, `deposit_amount`, `credits_per_deposit`, `deposits: u64`, `spends: u64`, `claimed_spends: u64`, `tree`, `leaves`, `nullifiers`, `vk_hash: [u8;32]` |
| `Tree` | zero-copy PDA `["tree"]` | `depth = 10`, `next_index`, `filled_subtrees[10]`, `zeros[10]`, `roots[32]`, `current_root_index` |
| `Leaves` | zero-copy, created client-side (`1024 × 32` bytes + header) | `count`, `leaves[1024][32]`, so the browser can rebuild the tree without an indexer |
| `NullifierSet` | zero-copy, created client-side (`4096 × 32` bytes + header) | `count`, open-addressing slots, index = first 4 bytes of nullifier mod capacity, linear probing |

The two large accounts are created by a script with `SystemProgram.createAccount` (owner = program) and then initialised by an instruction. This avoids paying rent for one account per nullifier.

**Instructions**

| Instruction | Signer | Effect |
|---|---|---|
| `initialize(forwarder_program, operator)` | admin | Create `Pool` and `Tree` (zeros computed with Poseidon), record the forwarder program |
| `init_large(kind)` | admin | Initialise `Leaves` or `NullifierSet` after client-side allocation |
| `deposit(commitment: [u8;32])` | user | Transfer exactly `deposit_amount` from the user's token account to the vault, insert the commitment (10 Poseidon syscalls), append to `Leaves`, push the new root, `deposits += 1`, emit `Deposited { leaf_index, commitment, root }` |
| `on_report(metadata: Vec<u8>, report: Vec<u8>)` | forwarder CPI | Verify the forwarder CPI, Borsh-decode `BrizoReport`, dispatch on its variant (below) |

`BrizoReport` (Borsh enum):

```rust
enum BrizoReport {
  Spend  { root: [u8;32], nullifier_hash: [u8;32], request_binding: [u8;32],
           proof_a: [u8;64], proof_b: [u8;128], proof_c: [u8;64] },
  Settle { epoch: u64 },
}
```

- **`Spend`:**
  - `root` must be in the root history;
  - `groth16-solana` verifies with public inputs `[root, nullifier_hash, request_binding]`;
  - insert `nullifier_hash` into `NullifierSet`, failing with `NullifierUsed` if it's already present;
  - `require!(spends + 1 <= deposits * credits_per_deposit)`;
  - `spends += 1`;
  - emit `Spent { nullifier_hash, request_binding }`.
- **`Settle`:**
  - `owed = (spends - claimed_spends) * credit_price`;
  - require the vault balance covers `owed`;
  - transfer vault → `operator`, signed by the pool PDA;
  - `claimed_spends = spends`;
  - emit `Settled { epoch, amount }`.

Fixed `on_report` accounts are `[state, forwarder_authority, pool (w)]`. Variant accounts go in `remaining_accounts`, in this exact order (the workflow hashes the account list into the report):
- Spend: `tree`, `nullifiers (w)`
- Settle: `vault (w)`, `operator (w)`, `token_program`

Errors: `InvalidForwarderProgram`, `MismatchedForwarderProgram`, `InvalidForwarderAuthority`, `InvalidReport`, `UnknownRoot`, `InvalidProof`, `NullifierUsed`, `NullifierSetFull`, `TreeFull`, `WrongDepositAmount`, `OverSpent`, `InsufficientVault`.

Compute: a Groth16 verify through the forwarder CPI needs a raised budget. Pass `computeConfig` in `writeReport` (start at 1,000,000 units; the default is 290,000). **[VERIFY]** S5.

Two `Pool` setups are needed, exactly like the template:
- one initialised against **CRE's simulator mock forwarder** (used by every `cre workflow simulate`, including with `--broadcast`);
- optionally one against the real devnet forwarder for a later deploy.

The mock forwarder values in the template's `config.simulation.json` are:
- `forwarderProgramId = 7kuEAA3mSC1Tz8gQjnvH7bKFda9xSPRRin9SZbH49cNK`
- `forwarderState = 5Tipz3yhTBdVsDbaBxZkrp7Gjf3brGq5SKkxReefPMP7`

Copy them from the template rather than from here, in case they change. Solana devnet chain selector name: `solana-devnet`.

### 4.4 CRE project `workflows/`

TypeScript and Bun, created with `cre init`. It contains three workflows that share one `project.yaml` (RPC `solana-devnet` → `https://api.devnet.solana.com`). Pin the SDK versions to the template's (`@chainlink/cre-sdk` 1.17.0, `@solana/web3.js` 1.98.4, `zod` 3.25.76) unless `cre init` generates newer ones.

**`brizo-spend`** — normal `handler`, HTTP trigger.
1. Payload: `{ requestId, root, nullifierHash, requestBinding, proofA, proofB, proofC }`, all hex.
2. Validate the shapes with zod.
3. Build the Borsh `BrizoReport::Spend` and the forwarder report, then call `SolanaClient(solana-devnet).writeReport` with accounts `[forwarderState (w), forwarderAuthority, pool (w), tree, nullifiers (w)]` and the raised `computeConfig`.
4. Return `{ requestId, txStatus, txSignature }`. Treat anything other than `SolanaTxStatus.SUCCESS` as a refusal.

Follow the template's generated binding (`contracts/ts/generated/KvStoreReceiver.ts`) for how the report is encoded and submitted.

**`brizo-infer`** — `handlerInTee(httpTrigger, onInfer, [{ tee: 'nitro', regions: ['us-west-2'] }])`.
1. Payload: `{ requestId, ciphertext, nonce, clientPub, requestBinding, mailboxUrl }`.
2. Inside the enclave:
   1. Get secrets `ENCLAVE_BOX_SK` and `MODEL_API_KEY`.
   2. Recompute `sha256(requestId ‖ ciphertext) mod r` and require it equals `requestBinding`.
   3. `nacl.box.open` the envelope.
   4. Enforce the character cap.
   5. Call the model with `HTTPClient` and `TeeRuntime` through **OpenRouter** (OpenAI-compatible: `POST https://openrouter.ai/api/v1/chat/completions`, header `Authorization: Bearer <MODEL_API_KEY>`, body `{ model, messages, max_tokens: 2000, response_format: { type: "json_object" } }`; model from config, default `anthropic/claude-haiku-4.5` — check the exact model ID on openrouter.ai/models), using the system prompt in §6. OpenRouter is one more party that sees the scrubbed question; list it in the threat model.
   6. Encrypt the answer with `nacl.box` to `clientPub`. The nonce is the first 24 bytes of `sha256(requestId ‖ "answer")`; the enclave has no randomness source.
   7. POST `{ requestId, ciphertext, nonce }` to `mailboxUrl`.
3. Cross back with `usingTheDons()` and return only `{ requestId, delivered: true }`.

Note that the TEE path uses the regular `HTTPClient` with `TeeRuntime`; `ConfidentialHTTPClient` is not available there (see the CRE skill's `confidential-workflows.md`).

**`brizo-settle`** — normal `handler`, cron trigger `0 */10 * * * *`. Writes `BrizoReport::Settle { epoch: floor(now / 600) }` with accounts `[forwarderState (w), forwarderAuthority, pool (w), vault (w), operator (w), tokenProgram]`.

**Secrets** (`workflows/secrets.yaml`, names only):

```yaml
secretsNames:
  MODEL_API_KEY:
    - SECRET_MODEL_API_KEY
  ENCLAVE_BOX_SK:
    - SECRET_ENCLAVE_BOX_SK
```

The matching public key `ENCLAVE_BOX_PK` goes in the app config.

**HTTP triggers:** simulation accepts an empty `authorizedKeys` list. A deployed HTTP trigger requires allow-listed EVM signer keys, so in production the gateway would sign every trigger with one shared key; users never get their own key, which would link their requests.

### 4.5 Gateway `gateway/` (Bun + Hono)

| Route | Behaviour |
|---|---|
| `POST /api/faucet { owner }` | Mint 20 tUSDC to the owner's token account (creating it if needed) and send 0.02 devnet SOL from the faucet keypair. Rate-limit per owner. |
| `POST /api/ask` | Body `{ requestId, ciphertext, nonce, clientPub, proof, publicSignals }`. (1) `snarkjs.groth16.verify`; (2) check the binding; (3) write `fixtures/<requestId>-spend.json` and run `cre workflow simulate ./brizo-spend ... --broadcast`; parse the tx signature from the output; (4) on success run the `brizo-infer` simulation with `mailboxUrl` pointing back at the gateway; (5) return `{ requestId, spendTx }`. Queue requests one at a time so simulations don't collide. |
| `POST /mailbox/:requestId` | Store the ciphertext (memory or SQLite) |
| `GET /api/answer/:requestId` | Return `202` until the answer exists; then return `{ ciphertext, nonce, spendTx }` |
| `GET /api/config` | Pool addresses, enclave public key, circuit file URLs |

Requires `cre login` on the gateway host and a funded devnet key in `.env` for broadcast simulations, as in the template's `.env.example` (`CRE_SOLANA_PRIVATE_KEY`, plus a placeholder `CRE_ETH_PRIVATE_KEY`).

### 4.6 Web app `app/` (Vite + React)

Screens, as one guided flow:

1. **Connect and fund.** Wallet Standard connection (`/solana-dev` guidance), then a faucet button.
2. **Deposit.**
   - Generate `secret` and `nk` (31 random bytes each) and compute the commitment with `circomlibjs` Poseidon.
   - Send `deposit`. Store the note in `localStorage`: `{ secret, nk, leafIndex, nextI }`. Show a "back up your note" export.
   - Show the deposit transaction on the explorer.
3. **Profile and question.**
   - Profile form: name, age, sex (only if the user marks it relevant), home city, travel, a lab value with units, a goal.
   - Free-text question.
4. **Privacy diff.**
   - Run the scrubber (§5: local model rewrite, then rules and leak check). Show "what you typed" next to "what will leave this browser", split into sub-questions, plus which scrubber mode ran.
   - Show the risk score and its breakdown. Above the threshold, require an explicit "send anyway".
5. **Ask.** For each sub-question:
   1. Read `Leaves` and rebuild the tree.
   2. `fullProve` with `i = nextI++`.
   3. Encrypt with `nacl.box` to the enclave public key.
   4. POST to `/api/ask`, then poll `/api/answer/:id`.
6. **Answer.**
   - Decrypt, then evaluate the branches with the real profile values.
   - Show the final advice, which branch was used and why, and the spend transaction links.
   - Include a "try to reuse this credit" button that replays the same proof and shows `NullifierUsed`.

## 5. Scrubber (two layers, all on the user's device)

### 5.1 Layer 1 — local model rewrite

Runs first when a local model is available. Its jobs: find identifying details in free text that rules can't catch (other people's names, employers, rare conditions, unusual events); split the question by topic; rewrite every sub-question in a neutral third-person voice so the user's writing style doesn't leave the device.

| Mode | How | Who uses it |
|---|---|---|
| Ollama (default when reachable) | Browser calls `http://localhost:11434/api/chat` with model `qwen3:8b` (configurable). Ollama must allow browser origins (`OLLAMA_ORIGINS`). | The team's demo machine, the video, real users with the desktop setup |
| WebLLM (stretch) | `@mlc-ai/web-llm` running a small instruct model on WebGPU inside the page | Judges with nothing installed (first load downloads ~1–2 GB) |
| None | Skip layer 1 and use the fail-closed rule below | Any browser without either |

The model receives the question **and** the profile, with instructions to output JSON `{ "subQuestions": [string], "removed": [string] }` using only the generalised values from layer 2's tables. Its output is never trusted alone; layer 2 always runs after it.

Status in the UI: show which mode ran ("Local model: qwen3:8b via Ollama" / "Rules only").

### 5.2 Layer 2 — deterministic rules and final check

Applies the table below to the profile, then checks every outgoing sub-question:
- **Leak check:** any exact profile value (name, exact age, city, exact lab number, exact date) still present blocks sending until the user edits or approves it.
- **Fail closed when layer 1 did not run:** any capitalised word or number in free text that the rules can't explain is highlighted and requires explicit approval.

| Field | Rule |
|---|---|
| Name, email, phone, ID numbers | Removed. Any occurrence of the profile name in the free text is replaced with "the person". |
| Age | Decade ("in their 30s") |
| Sex | Omitted unless the user marked it relevant; never inferred from a name |
| City | Region and climate from a small lookup table; unknown cities become "a city" |
| Dates | Relative weeks ("about 2 weeks away"); never invent a date the user didn't give |
| Lab values | Band against a published reference table stored in the app, with the source cited in a comment (e.g. ferritin below the lab's reference range → "below the usual reference range"). Never guess clinical bands. |
| Travel | Direction and time-zone shift computed correctly from the two cities (Singapore → Lisbon is westbound, clocks go back 7 hours) |
| Splitting | One sub-question per topic (diet, training, travel), each its own request |

Risk score: count the quasi-identifiers that survive scrubbing, weight rare ones (rare condition, small town, exact date) more heavily, and score the whole set of sub-questions as well as each one. Show the breakdown, e.g. "age band, region, condition → risk 52".

## 6. Model prompt (inside the enclave)

System prompt, stored in the workflow config:

> You answer health, fitness, travel and finance questions for an anonymous user. You will never receive identifying details. Give general, evidence-based guidance. Return only JSON matching this schema: `{"general": string, "branches": [{"when": {"field": string, "op": "lt"|"lte"|"gt"|"gte"|"eq", "value": number|string}, "advice": string}], "caveats": string}`. Use branches whenever the right answer depends on a value the user didn't give exactly (for example, a lab value band or a date range). Do not ask follow-up questions.

The browser evaluates `branches` against the real profile values. Invalid JSON is shown as plain text, with a note.

## 7. Request envelope

```json
{
  "requestId": "<32 hex>",
  "ciphertext": "<base64 nacl.box of {question, bands}>",
  "nonce": "<base64 24 bytes>",
  "clientPub": "<base64 x25519 public key, fresh per request>",
  "proof": { "pi_a": [], "pi_b": [], "pi_c": [] },
  "publicSignals": ["root", "nullifierHash", "requestBinding"]
}
```

## 8. Demo script (≤ 3 minutes)

1. Problem in one line: every AI request identifies you three ways.
2. Faucet, then deposit; show the deposit transaction.
3. Type a personal question; show the privacy diff and the risk breakdown.
4. Ask; show the `brizo-spend` simulation output with the Solana spend transaction and the on-chain Groth16 verification log, then the `brizo-infer` simulation output running in the TEE handler.
5. Answer appears, personalised locally.
6. Press "reuse credit"; show `NullifierUsed` rejected on-chain.
7. Show the `brizo-settle` transaction paying the operator only for verified spends.

## 9. Claims we may make (only if the matching evidence exists)

- "Raw personal data never leaves the user's device." (The local model runs on the device; the rules' leak check blocks any known personal value from being sent.)
- "A local model rewrites the question in a neutral voice, so your writing style doesn't leave the device." (Only when layer 1 ran; the hosted demo without Ollama or WebLLM runs rules only, and the UI says so.)
- "Payment uses zero-knowledge credits; the Solana program verifies each proof on-chain and rejects a reused credit."
- "Nobody, including us, can create credits; only deposits are in the tree."
- "The operator can only be paid for verified spends."
- "The model is called from inside a CRE Confidential Workflow; the API key and the decrypted question exist only in the enclave."
- "CRE runs in the simulator for this demo; Solana transactions are real devnet transactions."

Never claim: anonymity against a gateway that logs IPs; production deployment of Confidential Workflows; audited cryptography; real stablecoins.

## 10. Reference material

- CRE TypeScript SDK overview: https://docs.chain.link/cre/reference/sdk/overview-ts
- Solana client (TS): https://docs.chain.link/cre/reference/sdk/solana-client-ts
- Solana forwarder directory: https://docs.chain.link/cre/guides/workflow/using-solana-client/solana-forwarder-directory-ts
- Confidential Workflows: https://docs.chain.link/cre/concepts/confidential-workflows
- Agent skills: https://docs.chain.link/resources/chainlink-developer-agent-skills
- Template: https://github.com/smartcontractkit/cre-templates/tree/main/building-blocks/solana-read-write
- Confidential starters: https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/confidential-workflows
- groth16-solana: https://github.com/Lightprotocol/groth16-solana
- circomlib / circomlibjs: https://github.com/iden3/circomlib, https://github.com/iden3/circomlibjs

## 11. Extended features (P1 and P2 in `PLAN.md`)

Build these only in the order and time boxes set by `PLAN.md`. Each one that ships unlocks the claim listed with it; each one that doesn't goes on the "Limits and roadmap" slide.

### 11.1 E3 — Timing jitter

- The app sends sub-requests in random order, each after a delay drawn from an exponential distribution with a mean of 6 s, clipped to 2–20 s. The UI shows a countdown ("sending in 7 s").
- **Claim unlocked:** "Sub-questions are sent at random times so they can't be linked by arrival time." (Best-effort; say so.)

### 11.2 E4 — Quality and leak evaluation

Lives in `eval/`, writes `eval/results.md`.

- **Profiles:** 20 synthetic profiles. Each has a full list of personal fields: name, age, sex, home city, employer, a condition, a lab value, dates, and travel. The questions are written in mixed styles: short, rambling, and with other people's names.
- **Leak metric:** for each personal field, check every outgoing sub-question for an exact or fuzzy match (Levenshtein ≤ 2 for words; exact for numbers). Count both direct identifiers and surviving quasi-identifiers. Report per field and per scrubber mode (Ollama vs rules-only).
- **Quality metric:**
  - Run each question two ways through the same frontier model: raw, and through Brizo's pipeline including the branch fill-in.
  - A judge from a **different model family** scores usefulness and correctness for the real profile on a 1–10 scale. Present the two answers in random order and don't say which is which. Use OpenRouter (key `OPENROUTER_API_KEY` in `eval/.env`) to run the judge on a model from a different family than the answering model, e.g. a Google or OpenAI model when answers come from Claude.
  - Report means, n = 20, and the judge used.
- **Claim unlocked:** the measured numbers, with n and the judge stated.

### 11.3 E5 — Encrypted note backup

- **Export:** a file containing the notes, encrypted with a user password. Derive the key with scrypt (`@noble/hashes`, N = 2^15), then `nacl.secretbox`.
- **Import:** restores the notes and `nextI`. Warn that losing the file and the browser data loses the credits.

### 11.4 E6 — Gateway hardening

- `/api/ask`: 10 requests per minute per IP.
- `/api/faucet`: once per wallet per hour.
- Mailbox: delete on first successful read, and expire after 15 minutes.
- Log no request bodies.

### 11.5 E7 — Three-party ceremony

After `snarkjs groth16 setup`, each teammate runs `snarkjs zkey contribute` in turn, then exports the final zkey and verifying keys. Record each contribution hash in the README. This is still not a public ceremony, so say so.

### 11.6 E8 — Limits and roadmap

A README section and one slide listing every P3 item and every unbuilt P2 item, plus the honest limits from §2.

### 11.7 E9 — x402 top-up for agents

- **Request:** `GET /x402/topup?commitment=<hex>` answers `402 Payment Required` with x402 payment requirements:
  - network: Solana devnet;
  - asset: the tUSDC mint;
  - amount: 10 tUSDC;
  - `payTo`: the gateway treasury.
- **Settlement:** the agent pays with an x402 client and retries. The gateway confirms the payment on-chain (it acts as its own facilitator), then calls `deposit(commitment)` from its treasury.
- **Response:** the leaf index and the deposit tx.
- **What stays hidden:** the gateway learns that this payer owns *some* commitment, but spends stay unlinkable to it because the ZK proof hides which leaf is spent.
- **[VERIFY]** the current x402 Solana package names and payment payload format before building. This matches the CRE track's listed use case "AI agents consuming CRE workflows with x402 payments".
- **Claim unlocked:** "Agents top up over x402, then spend privately like everyone else."

### 11.8 E10 — Agent SDK and CLI

Lives in `sdk/`: a TypeScript package plus a `brizo` CLI.

- **Notes and proving:** holds notes in an encrypted file, rebuilds the tree from the `Leaves` account over RPC, and proves with snarkjs in Node.
- **Requests:** encrypts to the enclave key, calls the gateway, polls, and decrypts.
- **Spending cap:** a config value `maxCreditsPerDay`; refuses to spend beyond it.
- **Optional `--tor`:** routes requests through a local Tor SOCKS proxy with a random SOCKS username per request, so each request gets its own circuit.
- **Demo:** an agent script that asks three questions in a row.
- **Claim unlocked:** "Agents can use Brizo programmatically, with a spending cap."

### 11.9 E11 — Tor onion service

- `torrc`: `HiddenServiceDir` plus `HiddenServicePort 80 127.0.0.1:<gateway port>`.
- Publish the `.onion` address in `/api/config`. The app shows "Open via Tor Browser for network privacy", and the SDK uses the `.onion` address when `--tor` is set.
- **Claim unlocked:** "Over Tor, the gateway never sees your IP." Only for users who use it; the default web path still exposes the IP.

### 11.10 E12 — Redeem unused credits

- **Instruction:** a new direct instruction (not via CRE), `redeem(root, nullifier_hash, request_binding, proof_a, proof_b, proof_c)`, where `request_binding = sha256(recipient) mod r`. Binding the proof to the recipient stops the relayer from redirecting the payment.
- **Fees:** the gateway's relayer submits the transaction and pays the fee (`POST /api/redeem`), so the user's wallet never signs.
- **On-chain checks:** the program verifies the proof, inserts the nullifier, and transfers `credit_price` to the recipient's token account (the relayer pays to create it).
- **Accounting:** keep a separate `redeemed` counter. Enforce `spends + redeemed ≤ deposits × 200`; Settle pays only for `spends`.
- **App:** redeem in whole units of 20 credits (1 tUSDC), one proof per transaction, with random delays between them, to a fresh address.
- **Claim unlocked:** "Unused credits can be redeemed to a fresh address without revealing which deposit they came from."

### 11.11 E13 — WebLLM in the browser

- Use `@mlc-ai/web-llm` with a small instruct model from its prebuilt list (pick the smallest that returns valid JSON; **[VERIFY]** model IDs). Same prompt and JSON contract as the Ollama path.
- Run it only when WebGPU is available, and show download progress on first use.
- Mode order: Ollama if reachable, then WebLLM, then rules-only.
- **Claim unlocked:** "Judges get the local-model rewrite without installing anything."

### 11.12 E14 — Privacy receipts

- **Leaf:** for each sub-request the app makes a 32-byte salt and computes `leaf = sha256(salt ‖ requestBinding ‖ sha256(subQuestion))`. The leaf is sent with the request; on its own it reveals nothing.
- **Gateway:** collects the epoch's leaves, builds a Merkle root, and passes it to `brizo-settle`.
- **Program:** `BrizoReport::Settle` gains `receipts_root: [u8;32]`. The program emits it in `Settled` and keeps the last 32 roots in `Pool`.
- **User:** fetches the Merkle path from `/api/receipt/:requestId` and stores it with the salt.
- **Proving a disclosure later:** reveal the sub-question, the salt and the path.
- **Claim unlocked:** "You can prove exactly what you disclosed; nobody else can read it."

### 11.13 E15 — Single atomic TEE workflow

Only if spike S3 passed.

- **If the enclave handler can resume after a chain write:** one `handlerInTee` writes the Spend report through `usingTheDons()`, checks for `SUCCESS`, and only then calls the model.
- **If it can't:** call the model, cross back, write the Spend report, and have the gateway release the mailbox ciphertext only after the nullifier is on-chain.

Either way it replaces the two-step orchestration in the gateway.

### 11.14 E16 — Real forwarder and deployment

- Only if `cre account access` shows deploy access.
- Initialise a second `Pool` against Chainlink's devnet DON forwarder (from the Solana forwarder directory) and deploy `brizo-spend` and `brizo-settle` with `cre workflow deploy`.
- Confidential Workflows deployment needs separate private-beta enrolment, so `brizo-infer` stays in simulation unless that's granted.
- Ask before any deploy.

### 11.15 E17 — Model providers by config

- OpenRouter already gives one API for many providers, so E17 becomes a config change: `{ "url": "https://openrouter.ai/api/v1/chat/completions", "model": "<openrouter model id>" }`. Optionally add a direct-provider adapter (Anthropic Messages API) for users who don't want an intermediary.
- Default: OpenRouter with an Anthropic Haiku-class model.

### 11.16 R1 — Enclave-generated keys (roadmap)

**[VERIFY]** I don't know of a CRE feature that generates a key inside the enclave and publishes only an attested public key. Until one exists, the enclave box key is generated by us and uploaded as a secret, which means we could decrypt scrubbed questions we intercept. The roadmap is attested in-enclave key generation, with the public key published alongside its attestation.
