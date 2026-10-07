# Lane C implementation plan

Approved contract: `docs/HANDOFF-C.md`, user's 7 Oct approval. Shared SPEC stays untouched.

1. S7: test membership and credit range against real WASM; implement depth-10
   Poseidon circuit with public `[root, nullifierHash, requestBinding]`, 8-bit `i`,
   boolean path indices, and private binding square. Compile; verify the public
   Hermez power-12 BLAKE2b-512; setup and one contribution; export browser files,
   snarkjs verification key and groth16-solana 0.2.0 Rust key. Run Node proof and
   tampered-input rejection tests; verify converted proof in a Rust host checker.
2. Gateway: test binding vector and malformed envelopes first, then actual Hono
   requests with a controlled CRE executable. Assert spend failure never starts
   inference, success requires status and signature, request IDs cannot collide,
   and serialization works. Implement bounded body/queue, pre-verification,
   canonical compressed proof encoding, transient payload files, private
   loopback mailbox with request-state/nonce checks, single-read expiry, public
   config and opaque devnet faucet CLI. Approved A D1–D4 owns the wire format.
3. Integration: consume lane A commands and B public addresses when delivered;
   run the real two-workflow broadcast flow, record signature and logs. Until
   then label integration unverified. Reuse A's already generated enclave key
   and matching locally provisioned secret; publish its public key in config.
4. P1 after P0 end-to-end: E4 twenty synthetic profiles with fuzzy/exact leaks
   and randomized blind judging through different model families; E6 hardening;
   E7 ask teammates to make independent contributions, re-export and reverify.
5. P2 only after checkpoint and P1 completion: SDK/CLI (90 minutes), researched
   x402 (120 minutes), Tor (45 minutes). Drop half-done P2 at 19:30 SGT and
   freeze at 20:30 SGT. No deploy or mainnet action without approval.

Commit tested deliverables on lane-c without co-author trailers. Write only
circuits/, gateway/, sdk/, eval/, and explicitly requested lane C handoff/evidence.
