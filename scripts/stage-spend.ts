// Phase 1 of a spend (HANDOFF-A D6), as the gateway relayer sends it: brizo_pool.stage_spend
// verifies the Groth16 credit proof on-chain with this tx's own compute budget and records
// PendingSpend ["pending", pool, nullifierHash]. Phase 2 is the CRE brizo-spend workflow.
//
// Usage: cd scripts && node --env-file=.env --import tsx stage-spend.ts <stage.json>
// stage.json = { root, nullifierHash, requestBinding, proofA, proofB, proofC } (hex; proof
// points compressed, A already negated) — e.g. workflows/fixtures/requests/<id>/stage.json.
// RELAYER_KEYPAIR (default ADMIN_KEYPAIR) pays the pending account's rent and gets it back
// at finalize.
import anchor, { type Idl } from "@coral-xyz/anchor";
// Default import: Node's ESM loader can't see every named export of this CommonJS package.
const { AnchorProvider, Program, Wallet } = anchor;
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const home = (p: string) => p.replace(/^~/, process.env.HOME!);
const loadKeypair = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(home(p), "utf8"))));
const d = JSON.parse(readFileSync(process.env.DEVNET_CONFIG_PATH || resolve(root, "deploy/devnet.json"), "utf8"));
if (d.cluster !== "devnet") throw new Error("stage-spend requires devnet");
const relayer = loadKeypair(process.env.RELAYER_KEYPAIR ?? process.env.ADMIN_KEYPAIR ?? "~/.config/solana/id.json");

const file = process.argv[2];
if (!file) throw new Error("usage: stage-spend.ts <stage.json>");
const s = JSON.parse(readFileSync(resolve(file), "utf8"));
const bytes = (k: string, n: number) => {
  const b = Buffer.from(s[k], "hex");
  if (b.length !== n) throw new Error(`${k} must be ${n} bytes`);
  return [...b];
};

const conn = new Connection(process.env.RPC_URL || d.rpcUrl, "confirmed");
const program = new Program(
  JSON.parse(readFileSync(resolve(root, d.idl), "utf8")) as Idl,
  new AnchorProvider(conn, new Wallet(relayer), { commitment: "confirmed", preflightCommitment: "confirmed" })
);
const pool = new PublicKey(d.pool);
const [pending] = PublicKey.findProgramAddressSync(
  [Buffer.from("pending"), pool.toBuffer(), Buffer.from(s.nullifierHash, "hex")],
  program.programId
);

const sig = await program.methods
  .stageSpend(bytes("root", 32), bytes("nullifierHash", 32), bytes("requestBinding", 32), bytes("proofA", 32), bytes("proofB", 64), bytes("proofC", 32))
  .accounts({
    relayer: relayer.publicKey,
    pool,
    tree: new PublicKey(d.tree),
    nullifiers: new PublicKey(d.nullifiers),
    pending,
    systemProgram: SystemProgram.programId,
  })
  .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
  .rpc();

console.log(JSON.stringify({ staged: true, relayer: relayer.publicKey.toBase58(), pending: pending.toBase58(), tx: sig }));
console.log(`stage tx: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
