import { CronCapability, handler, Runner, type Runtime, solanaAccountMeta } from '@chainlink/cre-sdk'
import { z } from 'zod'
import { encodeSettleReport } from '../lib/fluxo'
import {
	base58Address,
	explorerTx,
	forwarderAccounts,
	forwarderConfigSchema,
	MAX_COMPUTE_LIMIT,
	writeFluxoReport,
} from '../lib/solana'

const configSchema = z.object({
	schedule: z.string(),
	epochSeconds: z.number().int().positive(),
	solana: forwarderConfigSchema.extend({
		pool: base58Address,
		vault: base58Address,
		operator: base58Address,
		tokenProgram: base58Address,
	}),
	computeLimit: z.number().int().positive().max(MAX_COMPUTE_LIMIT),
})
type Config = z.infer<typeof configSchema>

const onSettle = (runtime: Runtime<Config>): string => {
	const { solana, computeLimit, epochSeconds } = runtime.config
	const epoch = BigInt(Math.floor(runtime.now().getTime() / 1000 / epochSeconds))

	const accounts = forwarderAccounts(solana, [
		solanaAccountMeta(solana.pool, true),
		solanaAccountMeta(solana.vault, true),
		solanaAccountMeta(solana.operator, true),
		solanaAccountMeta(solana.tokenProgram),
	])

	runtime.log(`settle epoch=${epoch}`)
	const result = writeFluxoReport(runtime, solana, encodeSettleReport(epoch), accounts, computeLimit)

	if (result.txStatus === 'SUCCESS' && 'txSignature' in result) {
		runtime.log(`settle epoch=${epoch}: SUCCESS tx=${result.txSignature} explorer=${explorerTx(result.txSignature)}`)
		return JSON.stringify({ epoch: epoch.toString(), txStatus: 'SUCCESS', txSignature: result.txSignature })
	}
	const error = 'error' in result ? result.error : 'unknown'
	runtime.log(`settle epoch=${epoch}: REFUSED status=${result.txStatus} error=${error}`)
	return JSON.stringify({ epoch: epoch.toString(), txStatus: result.txStatus, error })
}

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onSettle)]

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}

main()
