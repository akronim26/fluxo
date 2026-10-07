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
import { z } from 'zod'
import { bytesToHex, encodeSpendReport, fieldElementHex } from '../lib/fluxo'
import { answerInEnclave, inferConfigShape, inferPayloadShape, mailboxRequest } from '../lib/infer'
import {
	base58Address,
	explorerTx,
	forwarderAccounts,
	forwarderConfigSchema,
	MAX_COMPUTE_LIMIT,
	pendingAddress,
	writeFluxoReport,
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
	const requestId = bytesToHex(req.requestId)

	const outcome = answerInEnclave(tee, req)

	const runtime = tee.usingTheDons()
	if (!('sealed' in outcome)) {
		runtime.log(`request ${requestId}: refused before payment (${outcome.status})`)
		return JSON.stringify({ requestId, status: outcome.status, delivered: false })
	}

	const { solana, computeLimit } = runtime.config
	const accounts = forwarderAccounts(solana, [
		solanaAccountMeta(solana.pool, true),
		solanaAccountMeta(pendingAddress(solana.receiverProgramId, solana.pool, req.nullifierHash), true),
		solanaAccountMeta(solana.nullifiers, true),
		solanaAccountMeta(req.relayer, true),
	])
	const spend = writeFluxoReport(
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

	const delivered = postSealed(runtime, mailboxRequest(runtime.config, requestId, outcome.sealed, outcome.nonce))
	runtime.log(`request ${requestId}: mailbox ${delivered ? 'accepted' : 'refused'}`)
	const status = outcome.status === 'model_error' ? 'model_error' : delivered ? 'delivered' : 'answered'
	return JSON.stringify({ requestId, status, delivered, spendTx: spend.txSignature })
}

const initWorkflow = (_config: Config) => [
	cre.handlerInTee(new cre.capabilities.HTTPCapability().trigger({}), onRequest, [
		{ tee: 'nitro', regions: ['us-west-2'] },
	]),
]

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}

main()
