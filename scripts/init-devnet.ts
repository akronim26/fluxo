import anchor, { type Idl } from "@coral-xyz/anchor";
const { AnchorProvider, BN, Program, Wallet } = anchor;
import { createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PollingConnection } from "./lib/connection.ts";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (!v) throw new Error(`missing env ${k}`);
  return v.replace(/^~/, process.env.HOME!);
};
const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "deploy/devnet.json");
if (existsSync(out)) throw new Error(`${out} exists; the pool is already initialised`);

const DEPOSIT = 10_000_000;
const CREDITS = 200;
const PRICE = 50_000;

const loadKeypair = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
const faucetPath = env("FAUCET_KEYPAIR");
if (!existsSync(faucetPath)) {
  mkdirSync(dirname(faucetPath), { recursive: true });
  writeFileSync(faucetPath, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
  console.log(`generated faucet authority keypair at ${faucetPath}`);
}
const faucet = loadKeypair(faucetPath);
const admin = loadKeypair(env("ADMIN_KEYPAIR", "~/.config/solana/id.json"));
const rpcUrl = env("RPC_URL", "https://api.devnet.solana.com");
const forwarderProgram = new PublicKey(env("FORWARDER_PROGRAM", "7kuEAA3mSC1Tz8gQjnvH7bKFda9xSPRRin9SZbH49cNK"));
const forwarderState = new PublicKey(env("FORWARDER_STATE", "5Tipz3yhTBdVsDbaBxZkrp7Gjf3brGq5SKkxReefPMP7"));

const idlSrc = resolve(root, "programs/target/idl/fluxo_pool.json");
const idl = JSON.parse(readFileSync(idlSrc, "utf8")) as Idl & { address: string };
const conn = new PollingConnection(rpcUrl, "confirmed");
const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
const program = new Program(idl, provider);
const programId = program.programId;

const [pool] = PublicKey.findProgramAddressSync([Buffer.from("pool"), forwarderProgram.toBuffer()], programId);
const [tree] = PublicKey.findProgramAddressSync([Buffer.from("tree"), pool.toBuffer()], programId);
const [forwarderAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("forwarder"), forwarderState.toBuffer(), programId.toBuffer()],
  forwarderProgram
);

console.log("creating tUSDC mint...");
const mint = await createMint(conn, admin, faucet.publicKey, null, 6);
const vault = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, pool, true)).address;
const operator = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey)).address;

const leaves = Keypair.generate();
const nullifiers = Keypair.generate();
const alloc = async (kp: Keypair, space: number) =>
  SystemProgram.createAccount({
    fromPubkey: admin.publicKey,
    newAccountPubkey: kp.publicKey,
    space,
    lamports: await conn.getMinimumBalanceForRentExemption(space),
    programId,
  });

console.log("allocating Leaves / NullifierSet and initialising the pool...");
const initTx = await program.methods
  .initialize(forwarderProgram, new BN(DEPOSIT), new BN(CREDITS), new BN(PRICE))
  .accounts({
    admin: admin.publicKey,
    pool,
    tree,
    leaves: leaves.publicKey,
    nullifiers: nullifiers.publicKey,
    mint,
    vault,
    operator,
    systemProgram: SystemProgram.programId,
  })
  .preInstructions([await alloc(leaves, 8 + 8 + 32 * 1024), await alloc(nullifiers, 8 + 8 + 32 * 4096)])
  .signers([leaves, nullifiers])
  .rpc();

mkdirSync(resolve(root, "deploy/idl"), { recursive: true });
copyFileSync(idlSrc, resolve(root, "deploy/idl/fluxo_pool.json"));

const devnet = {
  cluster: "devnet",
  rpcUrl,
  programId: programId.toBase58(),
  idl: "deploy/idl/fluxo_pool.json",
  pool: pool.toBase58(),
  tree: tree.toBase58(),
  leaves: leaves.publicKey.toBase58(),
  nullifiers: nullifiers.publicKey.toBase58(),
  vault: vault.toBase58(),
  operator: operator.toBase58(),
  mint: mint.toBase58(),
  mintDecimals: 6,
  faucetAuthority: faucet.publicKey.toBase58(),
  admin: admin.publicKey.toBase58(),
  forwarderProgramId: forwarderProgram.toBase58(),
  forwarderState: forwarderState.toBase58(),
  forwarderAuthority: forwarderAuthority.toBase58(),
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  depositAmount: DEPOSIT,
  creditsPerDeposit: CREDITS,
  creditPrice: PRICE,
  initTx,
};
writeFileSync(out, JSON.stringify(devnet, null, 2) + "\n");
console.log(JSON.stringify(devnet, null, 2));
console.log(`initialize tx: https://explorer.solana.com/tx/${initTx}?cluster=devnet`);
