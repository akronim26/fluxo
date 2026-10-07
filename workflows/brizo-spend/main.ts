// brizo-spend — normal handler, HTTP trigger. Phase 2 of a spend (HANDOFF-A D6).
//
// Phase 1 happened on-chain before this runs: the gateway relayer sent
// brizo_pool.stage_spend, which verified the user's Groth16 credit proof against
// a recent root and recorded a PendingSpend PDA ["pending", pool, nullifierHash].
//
// This workflow writes BrizoReport::Spend { nullifier_hash, request_binding } (65 bytes) through
// the keystone forwarder. on_report burns the nullifier (rejecting reuse), counts
// the spend and closes the pending account, refunding its rent to the relayer.
// The gateway runs brizo-infer only if this returns txStatus SUCCESS.
//
// Payload (docs/HANDOFF-A.md):
//   { requestId: 16 B hex, nullifierHash: 32 B hex, requestBinding: 32 B hex (big-endian),
//     relayer: base58 }
import { decodeJson, handler, HTTPCapability, Runner, type Runtime, solanaAccountMeta } from '@chainlink/cre-sdk'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'
import { bytesToHex, encodeSpendReport, fieldElementHex, hexOfBytes } from '../lib/brizo'
import {
	base58Address,
	explorerTx,
	forwarderAccounts,
	forwarderConfigSchema,
	MAX_COMPUTE_LIMIT,
	writeBrizoReport,
} from '../lib/solana'

const configSchema = z.object({
	solana: forwarderConfigSchema.extend({
		// brizo_pool accounts from deploy/devnet.json (the Pool initialised against
		// the forwarder this target writes through).
		pool: base58Address,
		nullifiers: base58Address,
	}),
	computeLimit: z.number().int().positive().max(MAX_COMPUTE_LIMIT),
})
type Config = z.infer<typeof configSchema>

const payloadSchema = z.object({
	requestId: hexOfBytes(16),
	nullifierHash: fieldElementHex,
	// Must equal the binding recorded by stage_spend (checked on-chain).
	requestBinding: fieldElementHex,
	// The account that paid for stage_spend; on_report checks it against the
	// PendingSpend record and refunds the rent to it.
	relayer: base58Address,
})

const PENDING_SEED = new TextEncoder().encode('pending')

// PendingSpend PDA ["pending", pool, nullifier_hash] under brizo_pool. web3.js's
// synchronous derivation: @solana/addresses needs crypto.subtle, absent in CRE.
const pendingAddress = (programId: string, pool: string, nullifierHash: Uint8Array): string =>
	PublicKey.findProgramAddressSync(
		[PENDING_SEED, new PublicKey(pool).toBytes(), nullifierHash],
		new PublicKey(programId),
	)[0].toBase58()

const onSpend = (runtime: Runtime<Config>, payload: { input: Uint8Array }): string => {
	const { solana, computeLimit } = runtime.config
	const req = payloadSchema.parse(decodeJson(payload.input))
	const requestId = bytesToHex(req.requestId)
	const nullifier = bytesToHex(req.nullifierHash)

	// on_report accounts: [state, forwarder_authority, pool (w)], then the Spend
	// variant's remaining accounts in this exact order: pending (w), nullifiers (w), relayer (w).
	const accounts = forwarderAccounts(solana, [
		solanaAccountMeta(solana.pool, true),
		solanaAccountMeta(pendingAddress(solana.receiverProgramId, solana.pool, req.nullifierHash), true),
		solanaAccountMeta(solana.nullifiers, true),
		solanaAccountMeta(req.relayer, true),
	])

	runtime.log(`spend ${requestId}: finalize nullifier=${nullifier}`)
	const result = writeBrizoReport(runtime, solana, encodeSpendReport(req.nullifierHash, req.requestBinding), accounts, computeLimit)

	if (result.txStatus === 'SUCCESS' && 'txSignature' in result) {
		runtime.log(`spend ${requestId}: SUCCESS tx=${result.txSignature} explorer=${explorerTx(result.txSignature)}`)
		return JSON.stringify({ requestId, txStatus: 'SUCCESS', txSignature: result.txSignature })
	}
	const error = 'error' in result ? result.error : 'unknown'
	runtime.log(`spend ${requestId}: REFUSED status=${result.txStatus} error=${error}`)
	return JSON.stringify({ requestId, txStatus: result.txStatus, error })
}

const initWorkflow = (_config: Config) => [
	// Simulation accepts an empty authorizedKeys list; a deployment allow-lists
	// the gateway's single shared signing key (SPEC §4.4).
	handler(new HTTPCapability().trigger({}), onSpend),
]

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}

main()
