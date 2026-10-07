// brizo-request — E15: one Confidential Workflow per paid question.
//
// Precondition (phase 1 of D6, on-chain): the gateway relayer sent
// brizo_pool.stage_spend, which verified the user's Groth16 credit proof and
// recorded PendingSpend { nullifier_hash, request_binding, relayer }.
//
// 1. In the enclave (handlerInTee): check the binding against the ciphertext, open
//    the envelope, call the model with the enclave-only API key, seal the answer to
//    the user's one-time key.
// 2. Cross back with usingTheDons(), carrying only the sealed answer (ciphertext the
//    DON can't read) and derived status.
// 3. On the DON: write BrizoReport::Spend { nullifier_hash, request_binding } through
//    the keystone forwarder. brizo_pool checks the binding equals the staged one,
//    burns the nullifier and counts the spend.
// 4. Only if that write succeeded, post the sealed answer to the gateway mailbox.
//    A refused spend (reused credit, unstaged, wrong binding) delivers nothing.
//
// Payload: brizo-infer's fields plus { nullifierHash: 64 hex, relayer: base58 }.
import {
	consensusIdenticalAggregation,
	cre,
	decodeJson,
	type HTTPSendRequester,
	ok,
	Runner,
	type Runtime,
	solanaAccountMeta,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'
import { encodeSpendReport, fieldElementHex } from '../lib/brizo'
import { answerInEnclave, inferConfigShape, inferPayloadShape, mailboxRequest, toHex } from '../lib/infer'
import {
	base58Address,
	explorerTx,
	forwarderAccounts,
	forwarderConfigSchema,
	MAX_COMPUTE_LIMIT,
	writeBrizoReport,
} from '../lib/solana'

const configSchema = z.object({
	...inferConfigShape,
	solana: forwarderConfigSchema.extend({ pool: base58Address, nullifiers: base58Address }),
	computeLimit: z.number().int().positive().max(MAX_COMPUTE_LIMIT),
})
type Config = z.infer<typeof configSchema>

const payloadSchema = z.object({
	...inferPayloadShape,
	nullifierHash: fieldElementHex,
	relayer: base58Address,
})

const PENDING_SEED = new TextEncoder().encode('pending')
const pendingAddress = (programId: string, pool: string, nullifierHash: Uint8Array): string =>
	PublicKey.findProgramAddressSync(
		[PENDING_SEED, new PublicKey(pool).toBytes(), nullifierHash],
		new PublicKey(programId),
	)[0].toBase58()

// DON-side mailbox post. The body is ciphertext sealed to the user, so it is safe
// outside the enclave; nodes agree on a boolean acknowledgement.
const postSealed = (runtime: Runtime<Config>, request: ReturnType<typeof mailboxRequest>): boolean =>
	new cre.capabilities.HTTPClient()
		.sendRequest(
			runtime,
			(sender: HTTPSendRequester, req: ReturnType<typeof mailboxRequest>) => ok(sender.sendRequest(req).result()),
			consensusIdenticalAggregation<boolean>(),
		)(request)
		.result()

const onRequest = (tee: TeeRuntime<Config>, payload: { input: Uint8Array }): string => {
	const req = payloadSchema.parse(decodeJson(payload.input))
	const requestId = toHex(req.requestId)

	// ── 1. Enclave ──
	const outcome = answerInEnclave(tee, req)

	// ── 2. Cross back: only the status and user-sealed ciphertext leave the enclave ──
	const runtime = tee.usingTheDons()
	if (!('sealed' in outcome)) {
		runtime.log(`request ${requestId}: refused before payment (${outcome.status})`)
		return JSON.stringify({ requestId, status: outcome.status, delivered: false })
	}

	// ── 3. Finalize the staged spend on Solana ──
	const { solana, computeLimit } = runtime.config
	const accounts = forwarderAccounts(solana, [
		solanaAccountMeta(solana.pool, true),
		solanaAccountMeta(pendingAddress(solana.receiverProgramId, solana.pool, req.nullifierHash), true),
		solanaAccountMeta(solana.nullifiers, true),
		solanaAccountMeta(req.relayer, true),
	])
	const spend = writeBrizoReport(
		runtime,
		solana,
		encodeSpendReport(req.nullifierHash, req.requestBinding),
		accounts,
		computeLimit,
	)
	if (!(spend.txStatus === 'SUCCESS' && 'txSignature' in spend)) {
		const error = 'error' in spend ? spend.error : 'unknown'
		runtime.log(`request ${requestId}: spend REFUSED (${error}); answer not delivered`)
		return JSON.stringify({ requestId, status: 'spend_refused', error, delivered: false })
	}
	runtime.log(`request ${requestId}: spend SUCCESS tx=${spend.txSignature} explorer=${explorerTx(spend.txSignature)}`)

	// ── 4. Deliver only after payment landed ──
	const delivered = postSealed(runtime, mailboxRequest(runtime.config, requestId, outcome.sealed, outcome.nonce))
	runtime.log(`request ${requestId}: mailbox ${delivered ? 'accepted' : 'refused'}`)
	// 'answered' = paid and answered, but the mailbox refused the sealed answer.
	const status = outcome.status === 'model_error' ? 'model_error' : delivered ? 'delivered' : 'answered'
	return JSON.stringify({ requestId, status, delivered, spendTx: spend.txSignature })
}

const initWorkflow = (_config: Config) => [
	// Simulation accepts an empty authorizedKeys list; a deployment allow-lists the
	// gateway's single shared signing key (SPEC §4.4).
	cre.handlerInTee(new cre.capabilities.HTTPCapability().trigger({}), onRequest, [
		{ tee: 'nitro', regions: ['us-west-2'] },
	]),
]

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}

main()
