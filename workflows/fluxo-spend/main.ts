import { decodeJson, handler, HTTPCapability, Runner, type Runtime, solanaAccountMeta } from '@chainlink/cre-sdk'
import { z } from 'zod'
import { bytesToHex, encodeSpendReport, fieldElementHex, hexOfBytes } from '../lib/fluxo'
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
	solana: forwarderConfigSchema.extend({
		pool: base58Address,
		nullifiers: base58Address,
	}),
	computeLimit: z.number().int().positive().max(MAX_COMPUTE_LIMIT),
})
type Config = z.infer<typeof configSchema>

const payloadSchema = z.object({
	requestId: hexOfBytes(16),
	nullifierHash: fieldElementHex,
	requestBinding: fieldElementHex,
	relayer: base58Address,
})

const onSpend = (runtime: Runtime<Config>, payload: { input: Uint8Array }): string => {
	const { solana, computeLimit } = runtime.config
	const req = payloadSchema.parse(decodeJson(payload.input))
	const requestId = bytesToHex(req.requestId)
	const nullifier = bytesToHex(req.nullifierHash)

	const accounts = forwarderAccounts(solana, [
		solanaAccountMeta(solana.pool, true),
		solanaAccountMeta(pendingAddress(solana.receiverProgramId, solana.pool, req.nullifierHash), true),
		solanaAccountMeta(solana.nullifiers, true),
		solanaAccountMeta(req.relayer, true),
	])

	runtime.log(`spend ${requestId}: finalize nullifier=${nullifier}`)
	const result = writeFluxoReport(runtime, solana, encodeSpendReport(req.nullifierHash, req.requestBinding), accounts, computeLimit)

	if (result.txStatus === 'SUCCESS' && 'txSignature' in result) {
		runtime.log(`spend ${requestId}: SUCCESS tx=${result.txSignature} explorer=${explorerTx(result.txSignature)}`)
		return JSON.stringify({ requestId, txStatus: 'SUCCESS', txSignature: result.txSignature })
	}
	const error = 'error' in result ? result.error : 'unknown'
	runtime.log(`spend ${requestId}: REFUSED status=${result.txStatus} error=${error}`)
	return JSON.stringify({ requestId, txStatus: result.txStatus, error })
}

const initWorkflow = (_config: Config) => [
	handler(new HTTPCapability().trigger({}), onSpend),
]

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}

main()
