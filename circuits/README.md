# Brizo credit circuit

Built during TOKEN2049 Origins on 7 Oct 2026. circomlib and snarkjs are upstream
libraries; groth16-solana is the upstream verifier. The custom circuit is ours.

The approved §4.2 corrections add a range constraint for `i` and a private
binding square. Public input order is root, nullifierHash, requestBinding.
Leaves use `Poseidon(secret, nk)`, nullifiers use `Poseidon(nk, i)`; empty leaf
is zero. Depth 10, boolean path indices, indices 0..199. Encryption happens
before proving: hash decoded requestId bytes followed by ciphertext bytes,
interpret SHA-256 big-endian modulo the BN254 scalar field.

Use Node 23, circom 2.2.3, and snarkjs 0.7.6:

```sh
npm ci --ignore-scripts
npm run compile
npm test
NO_DNA=1 cargo run --locked --manifest-path rust-check/Cargo.toml
```

Committed `build/` artifacts suffice to verify and generate fixture proofs;
`npm run fixtures` regenerates the synthetic proof and Rust export. Never
use the fixed synthetic note in a real deposit.

To repeat setup for a new circuit/key (this changes the keys consumed by B/D):

```sh
curl --fail --location https://circom.info/powersOfTau28_hez_final_12.ptau -o build/powersOfTau28_hez_final_12.ptau
node scripts/check-ptau.mjs
snarkjs groth16 setup build/credit.r1cs build/powersOfTau28_hez_final_12.ptau build/credit_0000.zkey
node scripts/contribute.mjs
snarkjs zkey verify build/credit.r1cs build/powersOfTau28_hez_final_12.ptau build/credit_final.zkey
snarkjs zkey export verificationkey build/credit_final.zkey build/verification_key.json
npm run fixtures
npm test
```

`contribute.mjs` creates entropy internally and prints only the public
contribution hash. Independent teammates can invoke it with input zkey,
output zkey and contributor name as its three arguments. Contributions must
be sequential. Verify the chain before copying the final output to
`credit_final.zkey`, exporting, and notifying B/D. Refresh provenance with
the public hashes. Currently this is a single-party phase-2 setup, not a
public ceremony or audited circuit.

Rust exports target **groth16-solana =0.2.0**. This version's field is
`vk_gamme_g2`; `nr_pubinputs` matches the official converter's IC length (4).
G1/G2 coordinates and public fields use big-endian bytes. Proof A is already
negated in the converted fixture; do not negate twice.

Approved HANDOFF-A D1–D4 uses **compressed** Spend points. Send
`build/sample-spend-compressed.json` to A's workflow; `sample-spend.json`
remains the uncompressed host-verifier fixture. `proofToSolanaCompressed`
encodes A/C as 32 bytes and B as 64 bytes after A's single negation. Its bytes
match native `solana-bn254 =2.2.2` compression. The Rust host check decompresses
using groth16-solana and verifies the result, and tests compare the complete
JS wire payload to that native fixture. Keys and public input order are unchanged.

The compressed report still requires A's `limits.simulation.json` override
(`Solana.ReportSizeLimit` 512b). This is a simulator integration, not a default
production DON deployment. B must measure the receiver's compute budget.

`spikes/` holds the throwaway reproduction of the initial shared-spec bugs.
