import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { buildPoseidon } from "circomlibjs";
import { expect } from "chai";
import { existsSync, readFileSync } from "fs";

const FORWARDER = new PublicKey(
  readFileSync("Anchor.toml", "utf8").match(/test_forwarder = "(\w+)"/)![1]
);
const FIXTURE = "../circuits/build/sample-spend-compressed.json";
const VECTORS = "../circuits/build/poseidon-vectors.json";

const DEPOSIT = 10_000_000;
const CREDITS = 200;
const PRICE = 50_000;
const DEPTH = 10;

const hex = (b: Uint8Array | Buffer) => Buffer.from(b).toString("hex");
const be32 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");
const rand31 = () => BigInt("0x" + hex(Keypair.generate().publicKey.toBytes().slice(0, 31)));

describe("fluxo_pool", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const conn = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const program: any = anchor.workspace.FluxoPool;

  const state = Keypair.generate();
  const leaves = Keypair.generate();
  const nullifiers = Keypair.generate();
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from("pool"), FORWARDER.toBuffer()], program.programId);
  const [tree] = PublicKey.findProgramAddressSync([Buffer.from("tree"), pool.toBuffer()], program.programId);
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("forwarder"), state.publicKey.toBuffer(), program.programId.toBuffer()],
    FORWARDER
  );
  const fixture = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;
  const vectors = JSON.parse(readFileSync(VECTORS, "utf8"));

  let H: (a: bigint, b: bigint) => bigint;
  let mint: PublicKey, vault: PublicKey, operator: PublicKey, userToken: PublicKey;
  const jsLeaves: bigint[] = [];

  const jsRoot = () => {
    let level = [...jsLeaves];
    let zero = 0n;
    for (let d = 0; d < DEPTH; d++) {
      const next: bigint[] = [];
      for (let i = 0; i < Math.max(1, Math.ceil(level.length / 2)); i++)
        next.push(H(level[2 * i] ?? zero, level[2 * i + 1] ?? zero));
      level = next;
      zero = H(zero, zero);
    }
    return level[0];
  };

  const send = async (ixs: TransactionInstruction[], signers: Keypair[] = []) => {
    const sig = await provider.sendAndConfirm(new Transaction().add(...ixs), signers, { commitment: "confirmed", preflightCommitment: "confirmed" });
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const cu = tx!.meta!.logMessages!.find((l) => l.startsWith(`Program ${program.programId} consumed`));
    return { sig, cu };
  };

  const report = (bytes: Buffer, rest: { pubkey: PublicKey; isWritable: boolean }[]) =>
    send([
      new TransactionInstruction({
        programId: FORWARDER,
        keys: [
          { pubkey: state.publicKey, isSigner: false, isWritable: false },
          { pubkey: authority, isSigner: false, isWritable: false },
          { pubkey: program.programId, isSigner: false, isWritable: false },
          { pubkey: pool, isSigner: false, isWritable: true },
          ...rest.map((a) => ({ ...a, isSigner: false })),
        ],
        data: program.coder.instruction.encode("onReport", { metadata: Buffer.alloc(0), report: bytes }),
      }),
    ]);

  const pendingPda = (nh: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("pending"), pool.toBuffer(), Buffer.from(nh, "hex")], program.programId)[0];
  const spendAccounts = (nh: string, relayer: PublicKey = payer.publicKey) => [
    { pubkey: pendingPda(nh), isWritable: true },
    { pubkey: nullifiers.publicKey, isWritable: true },
    { pubkey: relayer, isWritable: true },
  ];
  const stage = async (s: Record<string, string>) =>
    send([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      await program.methods
        .stageSpend(
          ...["root", "nullifierHash", "requestBinding", "proofA", "proofB", "proofC"].map((k) => [...Buffer.from(s[k], "hex")])
        )
        .accounts({ relayer: payer.publicKey, pool, tree, nullifiers: nullifiers.publicKey, pending: pendingPda(s.nullifierHash), systemProgram: SystemProgram.programId })
        .instruction(),
    ]);
  const settleAccounts = () => [
    { pubkey: vault, isWritable: true },
    { pubkey: operator, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false },
  ];
  const spendReport = (nh: string, binding: string = "00".repeat(32)) =>
    Buffer.concat([Buffer.from([0]), Buffer.from(nh, "hex"), Buffer.from(binding, "hex")]);
  const settleReport = (epoch: number) => {
    const b = Buffer.alloc(9);
    b[0] = 1;
    b.writeBigUInt64LE(BigInt(epoch), 1);
    return b;
  };
  const garbageSpend = (root: Buffer) => ({
    root: hex(root),
    nullifierHash: hex(be32(rand31())),
    requestBinding: hex(be32(rand31())),
    proofA: "11".repeat(32),
    proofB: "22".repeat(64),
    proofC: "33".repeat(32),
  });

  const expectFail = async (p: Promise<unknown>, code: string) => {
    try {
      await p;
    } catch (e: any) {
      expect(String(e) + (e.logs ?? []).join("\n")).to.include(code);
      return;
    }
    expect.fail(`expected ${code}`);
  };

  const fetchTree = () => program.account.tree.fetch(tree) as Promise<any>;
  const currentRoot = async () => {
    const t = await fetchTree();
    return Buffer.from(t.roots[t.currentRootIndex]);
  };

  before(async () => {
    const poseidon = await buildPoseidon();
    H = (a, b) => poseidon.F.toObject(poseidon([a, b]));

    mint = await createMint(conn, payer, payer.publicKey, null, 6);
    vault = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, pool, true)).address;
    operator = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, Keypair.generate().publicKey)).address;
    userToken = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey)).address;
    await mintTo(conn, payer, mint, userToken, payer, 100 * 1_000_000);

    const alloc = async (kp: Keypair, space: number, owner: PublicKey) =>
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: kp.publicKey,
        space,
        lamports: await conn.getMinimumBalanceForRentExemption(space),
        programId: owner,
      });
    await send([await alloc(state, 8, FORWARDER)], [state]);

    await program.methods
      .initialize(FORWARDER, new BN(DEPOSIT), new BN(CREDITS), new BN(PRICE))
      .accounts({
        admin: payer.publicKey,
        pool,
        tree,
        leaves: leaves.publicKey,
        nullifiers: nullifiers.publicKey,
        mint,
        vault,
        operator,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        await alloc(leaves, 8 + 8 + 32 * 1024, program.programId),
        await alloc(nullifiers, 8 + 8 + 32 * 4096, program.programId),
      ])
      .signers([leaves, nullifiers])
      .rpc();
  });

  it("poseidon test vector: circomlibjs Poseidon(1,2)", () => {
    expect(H(1n, 2n).toString(16)).to.equal("115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a");
  });

  it("poseidon vectors: lane C's zeros and one-leaf root match the JS tree", () => {
    let z = 0n;
    for (const expected of vectors.zeros) {
      expect(z.toString()).to.equal(expected);
      z = H(z, z);
    }
    jsLeaves.push(BigInt(vectors.commitment));
    expect(jsRoot().toString()).to.equal(vectors.root);
    expect(hex(be32(BigInt(vectors.root)))).to.equal(fixture.root);
    jsLeaves.pop();
  });

  it("initialize: empty root matches circomlibjs", async () => {
    expect(hex(await currentRoot())).to.equal(hex(be32(jsRoot())));
  });

  it("deposit: moves 10 tUSDC and on-chain Poseidon root matches circomlibjs", async () => {
    const commitments = [BigInt(vectors.commitment), H(rand31(), rand31())];
    for (const c of commitments) {
      const { cu } = await send([
        await program.methods
          .deposit([...be32(c)])
          .accounts({ user: payer.publicKey, pool, tree, leaves: leaves.publicKey, userToken, vault, tokenProgram: TOKEN_PROGRAM_ID })
          .instruction(),
      ]);
      console.log("      deposit", cu);
      jsLeaves.push(c);
      expect(hex(await currentRoot())).to.equal(hex(be32(jsRoot())));
    }
    expect(Number((await getAccount(conn, vault)).amount)).to.equal(2 * DEPOSIT);
    const p: any = await program.account.pool.fetch(pool);
    expect(p.deposits.toNumber()).to.equal(2);
    const l: any = await program.account.leaves.fetch(leaves.publicKey);
    expect(l.count).to.equal(2);
    expect(hex(Buffer.from(l.leaves[1]))).to.equal(hex(be32(commitments[1])));
  });

  it("deposit: rejects a commitment >= r", async () => {
    await expectFail(
      program.methods
        .deposit([...Buffer.alloc(32, 0xff)])
        .accounts({ user: payer.publicKey, pool, tree, leaves: leaves.publicKey, userToken, vault, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc(),
      "InvalidCommitment"
    );
  });

  it("stage: rejects an unknown root", async () => {
    await expectFail(stage(garbageSpend(be32(12345n))), "UnknownRoot");
  });

  it("stage: rejects an invalid proof", async () => {
    await expectFail(stage(garbageSpend(await currentRoot())), "InvalidProof");
  });

  it("finalize: rejects a spend that was never staged", async () => {
    const nh = hex(be32(rand31()));
    await expectFail(report(spendReport(nh), spendAccounts(nh)), "NotStaged");
  });

  it("finalize: rejects a caller that is not the forwarder", async () => {
    const fake = Keypair.generate();
    const nh = hex(be32(rand31()));
    await expectFail(
      program.methods
        .onReport(Buffer.alloc(0), spendReport(nh))
        .accounts({ state: state.publicKey, forwarderAuthority: fake.publicKey, pool })
        .remainingAccounts(spendAccounts(nh).map((a) => ({ ...a, isSigner: false })))
        .signers([fake])
        .rpc(),
      "InvalidForwarderAuthority"
    );
  });

  it("settle: nothing owed before any spend", async () => {
    const { cu } = await report(settleReport(1), settleAccounts());
    console.log("      settle (0 owed)", cu);
    expect(Number((await getAccount(conn, operator)).amount)).to.equal(0);
  });

  it("stage: valid proof verifies on-chain and records a pending spend (S5)", async function () {
    if (!fixture) return this.skip();
    const { cu, sig } = await stage(fixture);
    console.log("      stage", cu, sig);
    const pending: any = await program.account.pendingSpend.fetch(pendingPda(fixture.nullifierHash));
    expect(hex(Buffer.from(pending.requestBinding))).to.equal(fixture.requestBinding);
    const p: any = await program.account.pool.fetch(pool);
    expect(p.spends.toNumber()).to.equal(0);
  });

  it("stage: the same nullifier can't be staged twice", async function () {
    if (!fixture) return this.skip();
    await expectFail(stage(fixture), "already in use");
  });

  it("finalize: rejects a relayer other than the one that staged", async function () {
    if (!fixture) return this.skip();
    await expectFail(
      report(spendReport(fixture.nullifierHash, fixture.requestBinding), spendAccounts(fixture.nullifierHash, Keypair.generate().publicKey)),
      "InvalidReport"
    );
  });

  it("finalize: rejects a binding different from the staged one", async function () {
    if (!fixture) return this.skip();
    await expectFail(
      report(spendReport(fixture.nullifierHash, hex(be32(rand31()))), spendAccounts(fixture.nullifierHash)),
      "BindingMismatch"
    );
  });

  it("finalize: the 65-byte CRE report burns the nullifier, counts the spend, refunds the relayer", async function () {
    if (!fixture) return this.skip();
    const before = await conn.getBalance(payer.publicKey);
    const { cu, sig } = await report(spendReport(fixture.nullifierHash, fixture.requestBinding), spendAccounts(fixture.nullifierHash));
    console.log("      finalize", cu, sig);
    const p: any = await program.account.pool.fetch(pool);
    expect(p.spends.toNumber()).to.equal(1);
    expect(await conn.getAccountInfo(pendingPda(fixture.nullifierHash))).to.equal(null);
    expect(await conn.getBalance(payer.publicKey)).to.be.greaterThan(before);
  });

  it("reuse: staging or finalizing a spent nullifier fails with NullifierUsed", async function () {
    if (!fixture) return this.skip();
    await expectFail(stage(fixture), "NullifierUsed");
    await expectFail(report(spendReport(fixture.nullifierHash, fixture.requestBinding), spendAccounts(fixture.nullifierHash)), "NullifierUsed");
  });

  it("settle: pays the operator only for verified spends", async function () {
    if (!fixture) return this.skip();
    await expectFail(
      report(settleReport(2), [settleAccounts()[0], { pubkey: userToken, isWritable: true }, settleAccounts()[2]]),
      "InvalidReport"
    );
    const { cu } = await report(settleReport(2), settleAccounts());
    console.log("      settle", cu);
    expect(Number((await getAccount(conn, operator)).amount)).to.equal(PRICE);
    const p: any = await program.account.pool.fetch(pool);
    expect(p.claimedSpends.toNumber()).to.equal(1);
  });
});
