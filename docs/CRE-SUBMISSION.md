# CRE track — evidence field (paste-ready)

Everything below is reproducible from the repo and logged with full outputs in `docs/EVIDENCE.md`.
CRE CLI v1.37.0, `@chainlink/cre-sdk` 1.23.0. All workflows run with `cre workflow simulate`, because deploy access was not available during the hackathon. Solana writes are real devnet transactions through CRE's simulator mock forwarder, within CRE's **default** production limits (265 B Solana report, 300k CU).

---

**Workflows (TypeScript, `workflows/`):**
- **`brizo-request`**: HTTP trigger, **`handlerInTee`** (Nitro, us-west-2). In the enclave it checks that the ciphertext matches the paid proof, opens the user's `nacl.box` envelope with a Vault secret, calls the model through `HTTPClient` + `TeeRuntime` with the `MODEL_API_KEY` secret, and seals the answer to the user. It crosses back with `usingTheDons()` carrying only the sealed ciphertext, writes `Spend { nullifier_hash, request_binding }` with `SolanaClient.writeReport` to our Anchor program, and posts the answer to the gateway mailbox only if the payment landed.
- **`brizo-spend`** (HTTP) and **`brizo-infer`** (HTTP, `handlerInTee`): the same two halves as separate workflows.
- **`brizo-settle`**: cron → `writeReport(Settle)`; pays the operator only for finalized spends.

**Simulation commands:**
```
cre workflow simulate ./brizo-request --target simulation-settings --non-interactive --trigger-index 0 --http-payload ./fixtures/requests/<id>/request.json --broadcast --wasm "$PWD/build/brizo-request.wasm"
cre workflow simulate ./brizo-spend  --target simulation-settings --non-interactive --trigger-index 0 --http-payload ./fixtures/requests/<id>/spend.json --broadcast
cre workflow simulate ./brizo-infer  --target simulation-settings --non-interactive --trigger-index 0 --http-payload ./fixtures/infer.json
cre workflow simulate ./brizo-settle --target simulation-settings --non-interactive --trigger-index 0 --broadcast
```

**Results (Solana devnet; program `HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC`):**
- **Full paid question** through our gateway → `brizo-request` (TEE answer + spend finalize + mailbox), 14 s end to end; the answer decrypted by the client with `ok:true`, `anthropic/claude-haiku-4.5`. Spend tx https://explorer.solana.com/tx/5tUUkGvmce4YJYNedvZx5Qv2yhQWcxPNtcqzTkfriUu7ZYnd5EYf5QcPJpRNo6VF7Wbc3nz9pu6XsFDa7tB3e9ux?cluster=devnet
- **`brizo-request` run directly:** `model ok (finish=stop)` then `spend SUCCESS`, tx https://explorer.solana.com/tx/2Q49p6fWneo2JRh4MzVpAMiYVe3nz9fsm3SVeFheBop4uuwqQkWZxzqSnhg8UwTKfH5dePyCrg3D6aVWLTuuzabA?cluster=devnet
- **`brizo-spend` finalize** under the default `solana_report=265b`, tx https://explorer.solana.com/tx/34LDToSMPhcYfboPdaetufAcPteHGR3AHigPCHUgJZRFpxrAa2991D31X1p28JksgaPu8f1z19jyqpksCBCsmDR6?cluster=devnet
  - The Groth16 proof was verified on-chain in the preceding stage tx: https://explorer.solana.com/tx/33dQtAxLJRKtMv6MACydfKTUvMfTKePeZdn2gjWmJ7HkUe2tLUUexCWfuTxZKJuzVeLQ2C3HPDBwtvzKAdWujjCy?cluster=devnet
- **Reused credit replayed:** `{"txStatus":"0","error":"NullifierUsed (0x1776)"}`
- **`brizo-infer`:** a tampered binding returns `{"delivered":false,"status":"bad_binding"}` before decryption or any model call.
- **`brizo-settle`:** operator paid 0.05 tUSDC per finalized spend, tx https://explorer.solana.com/tx/56y25StBajhcbQRA2MxoGFY6Ayg2rzJLCg9kcpmg9Ga9FaGT1Bbspatzh7bkvgfdr64oLbLHEyTk5Usm42HqwxPR?cluster=devnet

**What stays confidential (the enclave):** the model API key, the box secret key, the decrypted question, and the plaintext answer. Only the request ID, status and user-sealed ciphertext cross back through `usingTheDons()`. No secrets are logged; simulation logs show IDs and status only.

**Spikes:** S1 (TEE + HTTP trigger), S2 (template broadcast), S3 (TEE handler → `usingTheDons()` → Solana write), S4 (nacl + sha256 in QuickJS), S6 (model call in the TEE): all pass.

Repo: https://github.com/akronim26/brizo — see `README.md`, `docs/EVIDENCE.md`, `workflows/`.
