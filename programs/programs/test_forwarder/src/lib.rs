//! Test-only stand-in for the CRE keystone forwarder (never deployed to devnet).
//! accounts: [state, forwarder_authority PDA, receiver program, ...receiver accounts]
//! data: the receiver instruction data (anchor `on_report` discriminator + args), passed through.
//! Signs as PDA ["forwarder", state, receiver] like the real forwarder; does no report checks.
#![allow(unexpected_cfgs)]
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, instruction::{AccountMeta, Instruction},
    program::invoke_signed, pubkey::Pubkey,
};

entrypoint!(process);

fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (state, authority, receiver) = (&accounts[0], &accounts[1], &accounts[2]);
    let (_, bump) =
        Pubkey::find_program_address(&[b"forwarder", state.key.as_ref(), receiver.key.as_ref()], program_id);
    let rest = &accounts[3..];
    let mut metas = vec![AccountMeta::new_readonly(*state.key, false), AccountMeta::new_readonly(*authority.key, true)];
    metas.extend(rest.iter().map(|a| AccountMeta { pubkey: *a.key, is_signer: false, is_writable: a.is_writable }));
    let mut infos = vec![state.clone(), authority.clone()];
    infos.extend(rest.iter().cloned());
    invoke_signed(
        &Instruction { program_id: *receiver.key, accounts: metas, data: data.to_vec() },
        &infos,
        &[&[b"forwarder", state.key.as_ref(), receiver.key.as_ref(), &[bump]]],
    )
}
