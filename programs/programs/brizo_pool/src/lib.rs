//! Brizo credit pool. Holds tUSDC deposits in a Poseidon Merkle tree.
//!
//! Spends are two-phase (HANDOFF-A D6) so the CRE report fits the DON's default
//! 265-byte Solana report limit:
//!   1. `stage_spend` (sent by the gateway relayer, with its own compute budget)
//!      verifies the Groth16 credit proof against a known root and records a
//!      `PendingSpend` PDA keyed by the nullifier.
//!   2. The CRE keystone-forwarder report `Spend { nullifier_hash, request_binding }`
//!      (65 bytes) finalizes it: the binding must equal the staged one (so a staged
//!      payment can't be paired with another request), then it burns the nullifier,
//!      counts the spend, closes the pending account and refunds its rent to the relayer.
//! `Settle` pays the operator for finalized spends only.
//!
//! The forwarder-CPI check is kept from cre-templates' `kv_store_receiver`.

#![allow(deprecated)] // anchor-lang 0.31 #[program] uses AccountInfo::realloc
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    pubkey,
};
use groth16_solana::decompression::{decompress_g1, decompress_g2};
use groth16_solana::groth16::{is_less_than_bn254_field_size_be, Groth16Verifier};
use solana_poseidon::{hashv, Endianness, Parameters};

// Copy of circuits/build/verifying_key.rs (lane C); recopy and rebuild after any new setup contribution.
mod vk;

declare_id!("HU1m8PzF8icY7FF1psP3VLDmxm9JZbCpAkByLxF3jpYC");

pub const DEPTH: usize = 10;
pub const ROOT_HISTORY: usize = 32;
pub const MAX_LEAVES: usize = 1024;
pub const NULLIFIER_CAP: usize = 4096;
pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

#[program]
pub mod brizo_pool {
    use super::*;

    /// Creates `Pool` and `Tree`, zero-initialises the client-allocated `Leaves` and
    /// `NullifierSet` accounts, and records the forwarder allowed to call `on_report`.
    /// `vault` must be a tUSDC token account owned by the pool PDA; `operator` a tUSDC
    /// token account that receives settlements.
    pub fn initialize(
        ctx: Context<Initialize>,
        forwarder_program: Pubkey,
        deposit_amount: u64,
        credits_per_deposit: u64,
        credit_price: u64,
    ) -> Result<()> {
        require!(forwarder_program != Pubkey::default(), BrizoError::InvalidForwarderProgram);
        require!(
            credit_price.checked_mul(credits_per_deposit) == Some(deposit_amount),
            BrizoError::InvalidConfig
        );
        let mint = ctx.accounts.mint.key();
        let pool_key = ctx.accounts.pool.key();
        check_token_account(&ctx.accounts.vault, &mint, Some(&pool_key))?;
        check_token_account(&ctx.accounts.operator, &mint, None)?;

        let pool = &mut ctx.accounts.pool;
        pool.admin = ctx.accounts.admin.key();
        pool.mint = mint;
        pool.vault = ctx.accounts.vault.key();
        pool.operator = ctx.accounts.operator.key();
        pool.forwarder_program = forwarder_program;
        pool.deposit_amount = deposit_amount;
        pool.credits_per_deposit = credits_per_deposit;
        pool.credit_price = credit_price;
        pool.tree = ctx.accounts.tree.key();
        pool.leaves = ctx.accounts.leaves.key();
        pool.nullifiers = ctx.accounts.nullifiers.key();
        pool.bump = ctx.bumps.pool;

        // Empty leaf = 0, zeros[i+1] = Poseidon(zeros[i], zeros[i]).
        let mut tree = ctx.accounts.tree.load_init()?;
        let mut z = [0u8; 32];
        for i in 0..DEPTH {
            tree.zeros[i] = z;
            tree.filled_subtrees[i] = z;
            z = poseidon2(&z, &z)?;
        }
        tree.roots[0] = z;
        ctx.accounts.leaves.load_init()?;
        ctx.accounts.nullifiers.load_init()?;
        Ok(())
    }

    /// Moves exactly `deposit_amount` into the vault and inserts `commitment` as a leaf.
    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        require!(is_less_than_bn254_field_size_be(&commitment), BrizoError::InvalidCommitment);
        require_keys_eq!(ctx.accounts.token_program.key(), TOKEN_PROGRAM_ID, BrizoError::InvalidTokenProgram);
        let pool = &mut ctx.accounts.pool;
        invoke(
            &token_transfer(
                ctx.accounts.user_token.key,
                ctx.accounts.vault.key,
                ctx.accounts.user.key,
                pool.deposit_amount,
            ),
            &[
                ctx.accounts.user_token.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // Incremental Merkle insert; path index bit 0 = current node is the left child.
        let mut tree = ctx.accounts.tree.load_mut()?;
        let leaf_index = tree.next_index as usize;
        require!(leaf_index < MAX_LEAVES, BrizoError::TreeFull);
        let (mut idx, mut cur) = (leaf_index, commitment);
        for i in 0..DEPTH {
            cur = if idx % 2 == 0 {
                tree.filled_subtrees[i] = cur;
                poseidon2(&cur, &tree.zeros[i])?
            } else {
                poseidon2(&tree.filled_subtrees[i], &cur)?
            };
            idx /= 2;
        }
        tree.next_index += 1;
        let ri = (tree.current_root_index as usize + 1) % ROOT_HISTORY;
        tree.current_root_index = ri as u32;
        tree.roots[ri] = cur;

        let mut leaves = ctx.accounts.leaves.load_mut()?;
        leaves.leaves[leaf_index] = commitment;
        leaves.count = tree.next_index;
        pool.deposits += 1;

        emit!(Deposited { leaf_index: leaf_index as u32, commitment, root: cur });
        Ok(())
    }

    /// Phase 1 of a spend. Anyone may stage (normally the gateway relayer, which pays
    /// rent for the pending account and gets it back at finalize); only a valid proof
    /// for an unspent nullifier against a recent root gets through.
    pub fn stage_spend(
        ctx: Context<StageSpend>,
        root: [u8; 32],
        nullifier_hash: [u8; 32],
        request_binding: [u8; 32],
        proof_a: [u8; 32],
        proof_b: [u8; 64],
        proof_c: [u8; 32],
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;
        require!(
            root != [0u8; 32] && ctx.accounts.tree.load()?.roots.contains(&root),
            BrizoError::UnknownRoot
        );
        require!(
            !nullifier_exists(&*ctx.accounts.nullifiers.load()?, &nullifier_hash),
            BrizoError::NullifierUsed
        );
        require!(spends_allowed(pool) > pool.spends + pool.redeemed, BrizoError::OverSpent);
        verify_credit_proof(&proof_a, &proof_b, &proof_c, &[root, nullifier_hash, request_binding])?;

        let pending = &mut ctx.accounts.pending;
        pending.pool = pool.key();
        pending.nullifier_hash = nullifier_hash;
        pending.request_binding = request_binding;
        pending.relayer = ctx.accounts.relayer.key();
        pending.staged_slot = Clock::get()?.slot;
        pending.bump = ctx.bumps.pending;
        emit!(Staged { nullifier_hash, request_binding });
        Ok(())
    }

    /// Called by the keystone forwarder's CPI with a Borsh `BrizoReport`.
    /// remaining_accounts: Spend `[pending (w), nullifiers (w), relayer (w)]`;
    /// Settle `[vault (w), operator (w), token_program]`.
    pub fn on_report<'info>(
        ctx: Context<'_, '_, 'info, 'info, OnReport<'info>>,
        _metadata: Vec<u8>,
        report: Vec<u8>,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        verify_forwarder_cpi(&ctx.accounts.state, &ctx.accounts.forwarder_authority, pool)?;
        let report = BrizoReport::try_from_slice(&report).map_err(|_| error!(BrizoError::InvalidReport))?;
        let rest = ctx.remaining_accounts;

        match report {
            BrizoReport::Spend { nullifier_hash, request_binding } => {
                require!(rest.len() == 3, BrizoError::InvalidReport);
                let (pending_info, nullifiers_info, relayer) = (&rest[0], &rest[1], &rest[2]);
                require_keys_eq!(nullifiers_info.key(), pool.nullifiers, BrizoError::InvalidReport);
                let pool_key = pool.key();
                let (expected, _) = Pubkey::find_program_address(
                    &[b"pending", pool_key.as_ref(), nullifier_hash.as_ref()],
                    &crate::ID,
                );
                require_keys_eq!(pending_info.key(), expected, BrizoError::InvalidReport);
                let nullifiers = AccountLoader::<NullifierSet>::try_from(nullifiers_info)?;

                // Not staged (or already finalized and closed): say which.
                if pending_info.owner != &crate::ID || pending_info.data_is_empty() {
                    require!(
                        !nullifier_exists(&*nullifiers.load()?, &nullifier_hash),
                        BrizoError::NullifierUsed
                    );
                    return err!(BrizoError::NotStaged);
                }
                let pending = Account::<PendingSpend>::try_from(pending_info)?;
                require_keys_eq!(pending.pool, pool_key, BrizoError::InvalidReport);
                require_keys_eq!(relayer.key(), pending.relayer, BrizoError::InvalidReport);
                require!(pending.request_binding == request_binding, BrizoError::BindingMismatch);

                require!(spends_allowed(pool) > pool.spends + pool.redeemed, BrizoError::OverSpent);
                insert_nullifier(&mut *nullifiers.load_mut()?, &nullifier_hash)?;
                pool.spends += 1;
                emit!(Spent { nullifier_hash, request_binding: pending.request_binding });
                pending.close(relayer.clone())?;
            }
            BrizoReport::Settle { epoch } => {
                require!(rest.len() == 3, BrizoError::InvalidReport);
                let (vault, operator, token_program) = (&rest[0], &rest[1], &rest[2]);
                require_keys_eq!(vault.key(), pool.vault, BrizoError::InvalidReport);
                require_keys_eq!(operator.key(), pool.operator, BrizoError::InvalidReport);
                require_keys_eq!(token_program.key(), TOKEN_PROGRAM_ID, BrizoError::InvalidTokenProgram);

                let owed = (pool.spends - pool.claimed_spends)
                    .checked_mul(pool.credit_price)
                    .ok_or(BrizoError::InvalidConfig)?;
                require!(token_amount(vault)? >= owed, BrizoError::InsufficientVault);
                if owed > 0 {
                    let bump = [pool.bump];
                    let seeds: &[&[u8]] = &[b"pool", pool.forwarder_program.as_ref(), &bump];
                    invoke_signed(
                        &token_transfer(vault.key, operator.key, &pool.key(), owed),
                        &[vault.clone(), operator.clone(), pool.to_account_info(), token_program.clone()],
                        &[seeds],
                    )?;
                }
                pool.claimed_spends = pool.spends;
                emit!(Settled { epoch, amount: owed });
            }
        }
        Ok(())
    }
}

// ─── Report ──────────────────────────────────────────────────

/// Borsh layout written by `workflows/lib/brizo.ts` (HANDOFF-A D6). `Spend` is 65 bytes
/// so the signed report fits CRE's default 265-byte Solana report limit.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum BrizoReport {
    Spend {
        nullifier_hash: [u8; 32],
        request_binding: [u8; 32],
    },
    Settle {
        epoch: u64,
    },
}

// ─── Helpers ─────────────────────────────────────────────────

fn poseidon2(l: &[u8; 32], r: &[u8; 32]) -> Result<[u8; 32]> {
    hashv(Parameters::Bn254X5, Endianness::BigEndian, &[l, r])
        .map(|h| h.to_bytes())
        .map_err(|_| error!(BrizoError::PoseidonFailed))
}

fn spends_allowed(pool: &Pool) -> u64 {
    pool.deposits.saturating_mul(pool.credits_per_deposit)
}

/// `a` is already negated (groth16-solana convention); all points compressed.
/// `verify()` rejects public inputs >= r, so `x` and `x + r` can't both be spent.
fn verify_credit_proof(a: &[u8; 32], b: &[u8; 64], c: &[u8; 32], inputs: &[[u8; 32]; 3]) -> Result<()> {
    let a = decompress_g1(a).map_err(|_| error!(BrizoError::InvalidProof))?;
    let b = decompress_g2(b).map_err(|_| error!(BrizoError::InvalidProof))?;
    let c = decompress_g1(c).map_err(|_| error!(BrizoError::InvalidProof))?;
    Groth16Verifier::new(&a, &b, &c, inputs, &vk::VERIFYINGKEY)
        .and_then(|mut v| v.verify())
        .map_err(|_| error!(BrizoError::InvalidProof))
}

fn nullifier_exists(set: &NullifierSet, n: &[u8; 32]) -> bool {
    let mut i = u32::from_be_bytes([n[0], n[1], n[2], n[3]]) as usize % NULLIFIER_CAP;
    loop {
        if set.slots[i] == *n {
            return true;
        }
        if set.slots[i] == [0u8; 32] {
            return false;
        }
        i = (i + 1) % NULLIFIER_CAP;
    }
}

/// Open addressing: slot = first 4 bytes (BE) mod capacity, linear probing; zero = empty.
fn insert_nullifier(set: &mut NullifierSet, n: &[u8; 32]) -> Result<()> {
    require!(*n != [0u8; 32], BrizoError::InvalidReport);
    let mut i = u32::from_be_bytes([n[0], n[1], n[2], n[3]]) as usize % NULLIFIER_CAP;
    loop {
        if set.slots[i] == *n {
            return err!(BrizoError::NullifierUsed);
        }
        if set.slots[i] == [0u8; 32] {
            require!((set.count as usize) < NULLIFIER_CAP - 1, BrizoError::NullifierSetFull);
            set.slots[i] = *n;
            set.count += 1;
            return Ok(());
        }
        i = (i + 1) % NULLIFIER_CAP;
    }
}

fn token_transfer(from: &Pubkey, to: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = vec![3u8]; // spl-token Transfer
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*from, false),
            AccountMeta::new(*to, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

/// spl-token Account layout: mint [0..32], owner [32..64], amount [64..72].
fn check_token_account(acc: &AccountInfo, mint: &Pubkey, owner: Option<&Pubkey>) -> Result<()> {
    require_keys_eq!(*acc.owner, TOKEN_PROGRAM_ID, BrizoError::InvalidTokenAccount);
    let data = acc.try_borrow_data()?;
    require!(data.len() == 165, BrizoError::InvalidTokenAccount);
    require!(data[0..32] == mint.to_bytes(), BrizoError::InvalidTokenAccount);
    if let Some(o) = owner {
        require!(data[32..64] == o.to_bytes(), BrizoError::InvalidTokenAccount);
    }
    Ok(())
}

fn token_amount(acc: &AccountInfo) -> Result<u64> {
    require_keys_eq!(*acc.owner, TOKEN_PROGRAM_ID, BrizoError::InvalidTokenAccount);
    let data = acc.try_borrow_data()?;
    require!(data.len() == 165, BrizoError::InvalidTokenAccount);
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

fn verify_forwarder_cpi(state: &UncheckedAccount, forwarder_authority: &Signer, pool: &Pool) -> Result<()> {
    let forwarder_program = pool.forwarder_program;
    require_keys_eq!(*state.owner, forwarder_program, BrizoError::MismatchedForwarderProgram);
    let state_key = state.key();
    let seeds: &[&[u8]] = &[b"forwarder", state_key.as_ref(), crate::ID.as_ref()];
    let (expected, _) = Pubkey::find_program_address(seeds, &forwarder_program);
    require_keys_eq!(expected, forwarder_authority.key(), BrizoError::InvalidForwarderAuthority);
    Ok(())
}

// ─── Accounts ────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub operator: Pubkey,
    pub forwarder_program: Pubkey,
    pub tree: Pubkey,
    pub leaves: Pubkey,
    pub nullifiers: Pubkey,
    pub deposit_amount: u64,
    pub credits_per_deposit: u64,
    pub credit_price: u64,
    pub deposits: u64,
    pub spends: u64,
    pub claimed_spends: u64,
    pub redeemed: u64,
    pub bump: u8,
}

#[account(zero_copy)]
pub struct Tree {
    pub next_index: u32,
    pub current_root_index: u32,
    pub filled_subtrees: [[u8; 32]; 10],
    pub zeros: [[u8; 32]; 10],
    pub roots: [[u8; 32]; 32],
}

/// Every commitment in insertion order, so clients rebuild the tree without an indexer.
#[account(zero_copy)]
pub struct Leaves {
    pub count: u32,
    pub _pad: u32,
    pub leaves: [[u8; 32]; 1024],
}

#[account(zero_copy)]
pub struct NullifierSet {
    pub count: u32,
    pub _pad: u32,
    pub slots: [[u8; 32]; 4096],
}

#[derive(Accounts)]
#[instruction(forwarder_program: Pubkey)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Pool::INIT_SPACE,
              seeds = [b"pool", forwarder_program.as_ref()], bump)]
    pub pool: Account<'info, Pool>,
    #[account(init, payer = admin, space = 8 + std::mem::size_of::<Tree>(),
              seeds = [b"tree", pool.key().as_ref()], bump)]
    pub tree: AccountLoader<'info, Tree>,
    /// Allocated by the client (SystemProgram.createAccount, owner = this program).
    #[account(zero)]
    pub leaves: AccountLoader<'info, Leaves>,
    /// Allocated by the client (SystemProgram.createAccount, owner = this program).
    #[account(zero)]
    pub nullifiers: AccountLoader<'info, NullifierSet>,
    /// CHECK: only its key is recorded; the token accounts are checked against it.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: checked in `check_token_account` (mint, owner = pool PDA).
    pub vault: UncheckedAccount<'info>,
    /// CHECK: checked in `check_token_account` (mint).
    pub operator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(mut, address = pool.tree)]
    pub tree: AccountLoader<'info, Tree>,
    #[account(mut, address = pool.leaves)]
    pub leaves: AccountLoader<'info, Leaves>,
    /// CHECK: the token program enforces owner = user and mint = vault's mint.
    #[account(mut)]
    pub user_token: UncheckedAccount<'info>,
    /// CHECK: must be the pool's vault.
    #[account(mut, address = pool.vault)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: checked against TOKEN_PROGRAM_ID in the handler.
    pub token_program: UncheckedAccount<'info>,
}

/// A spend whose proof verified in `stage_spend`, waiting for the CRE report.
#[account]
#[derive(InitSpace)]
pub struct PendingSpend {
    pub pool: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub request_binding: [u8; 32],
    pub relayer: Pubkey,
    pub staged_slot: u64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(root: [u8; 32], nullifier_hash: [u8; 32])]
pub struct StageSpend<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    pub pool: Account<'info, Pool>,
    #[account(address = pool.tree)]
    pub tree: AccountLoader<'info, Tree>,
    #[account(address = pool.nullifiers)]
    pub nullifiers: AccountLoader<'info, NullifierSet>,
    #[account(init, payer = relayer, space = 8 + PendingSpend::INIT_SPACE,
              seeds = [b"pending", pool.key().as_ref(), nullifier_hash.as_ref()], bump)]
    pub pending: Account<'info, PendingSpend>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OnReport<'info> {
    /// CHECK: forwarder state; owner must equal `pool.forwarder_program` (verify_forwarder_cpi).
    pub state: UncheckedAccount<'info>,
    /// PDA signer supplied by the forwarder CPI; verified in `verify_forwarder_cpi`.
    pub forwarder_authority: Signer<'info>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
}

// ─── Events and errors ───────────────────────────────────────

#[event]
pub struct Deposited {
    pub leaf_index: u32,
    pub commitment: [u8; 32],
    pub root: [u8; 32],
}

#[event]
pub struct Staged {
    pub nullifier_hash: [u8; 32],
    pub request_binding: [u8; 32],
}

#[event]
pub struct Spent {
    pub nullifier_hash: [u8; 32],
    pub request_binding: [u8; 32],
}

#[event]
pub struct Settled {
    pub epoch: u64,
    pub amount: u64,
}

#[error_code]
pub enum BrizoError {
    #[msg("forwarder_program must be a non-default pubkey")]
    InvalidForwarderProgram,
    #[msg("Forwarder state owner does not match the pool's forwarder_program")]
    MismatchedForwarderProgram,
    #[msg("forwarder_authority is not the PDA for this state, receiver and forwarder")]
    InvalidForwarderAuthority,
    #[msg("Report payload or its accounts are malformed")]
    InvalidReport,
    #[msg("Root is not in the recent root history")]
    UnknownRoot,
    #[msg("Groth16 proof did not verify")]
    InvalidProof,
    #[msg("Nullifier already spent")]
    NullifierUsed,
    #[msg("Nullifier set is full")]
    NullifierSetFull,
    #[msg("Merkle tree is full")]
    TreeFull,
    #[msg("Spends would exceed deposited credits")]
    OverSpent,
    #[msg("Vault balance does not cover the settlement")]
    InsufficientVault,
    #[msg("credit_price * credits_per_deposit must equal deposit_amount")]
    InvalidConfig,
    #[msg("Commitment must be a BN254 field element")]
    InvalidCommitment,
    #[msg("Token account has the wrong program, mint or owner")]
    InvalidTokenAccount,
    #[msg("Not the SPL Token program")]
    InvalidTokenProgram,
    #[msg("Poseidon syscall failed")]
    PoseidonFailed,
    #[msg("No staged spend for this nullifier; call stage_spend first")]
    NotStaged,
    #[msg("request_binding differs from the staged spend's")]
    BindingMismatch,
}
