// Devnet deposit from the admin wallet: mints 10 tUSDC with the faucet authority, then
// deposit(commitment). Default commitment = lane C's vector (Poseidon(123, 456)), whose
// one-leaf root is the root in circuits/build/sample-spend-compressed.json.
// Usage: cd scripts && node --env-file=.env --import tsx deposit.ts [commitment-decimal]
import anchor, { type Idl } from "@coral-xyz/anchor";
// Default import: Node's ESM loader can't see every named export of this CommonJS package.
const { AnchorProvider, Program, Wallet } = anchor;
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const home = (p: string) => p.replace(/^~/, process.env.HOME!);
const loadKeypair = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(home(p), "utf8"))));
const d = JSON.parse(readFileSync(resolve(root, "deploy/devnet.json"), "utf8"));
const admin = loadKeypair(process.env.ADMIN_KEYPAIR ?? "~/.config/solana/id.json");
const faucet = loadKeypair(process.env.FAUCET_KEYPAIR ?? "~/.config/brizo/faucet-authority.json");
const commitment = BigInt(
  process.argv[2] ?? JSON.parse(readFileSync(resolve(root, "circuits/build/poseidon-vectors.json"), "utf8")).commitment
);

const conn = new Connection(process.env.RPC_URL || d.rpcUrl, "confirmed");
const program = new Program(
  JSON.parse(readFileSync(resolve(root, d.idl), "utf8")) as Idl,
  new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" })
);
const mint = new PublicKey(d.mint);
const userToken = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey)).address;
await mintTo(conn, admin, mint, userToken, faucet, d.depositAmount);

const sig = await program.methods
  .deposit([...Buffer.from(commitment.toString(16).padStart(64, "0"), "hex")])
  .accounts({
    user: admin.publicKey,
    pool: new PublicKey(d.pool),
    tree: new PublicKey(d.tree),
    leaves: new PublicKey(d.leaves),
    userToken,
    vault: new PublicKey(d.vault),
    tokenProgram: new PublicKey(d.tokenProgram),
  })
  .rpc();
const tree: any = await (program.account as any).tree.fetch(new PublicKey(d.tree));
console.log(`leaf ${tree.nextIndex - 1}, root ${Buffer.from(tree.roots[tree.currentRootIndex]).toString("hex")}`);
console.log(`deposit tx: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
