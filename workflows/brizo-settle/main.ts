// brizo-settle — normal handler, cron trigger.
//
// Writes BrizoReport::Settle { epoch } to brizo_pool.on_report. The program pays
// the operator (spends - claimed_spends) * credit_price from the vault, so the
// operator is only ever paid for spends whose proofs were verified on-chain.
// The report is 9 bytes, well inside CRE's default Solana report limit.
import { CronCapability, handler, Runner, type Runtime, solanaAccountMeta } from '@chainlink/cre-sdk'
import { z } from 'zod'
import { encodeSettleReport } from '../lib/brizo'
import {
	base58Address,
	explorerTx,
	forwarderAccounts,
	forwarderConfigSchema,
	MAX_COMPUTE_LIMIT,
	writeBrizoReport,
} from '../lib/solana'

const configSchema = z.object({
	// 6-field cron; SPEC §4.4: every 10 minutes.
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

	// on_report accounts: [state, forwarder_authority, pool (w)], then the Settle
	// variant's remaining accounts in this exact order: vault (w), operator (w), token_program.
	const accounts = forwarderAccounts(solana, [
		solanaAccountMeta(solana.pool, true),
		solanaAccountMeta(solana.vault, true),
		solanaAccountMeta(solana.operator, true),
		solanaAccountMeta(solana.tokenProgram),
	])

	runtime.log(`settle epoch=${epoch}`)
	const result = writeBrizoReport(runtime, solana, encodeSettleReport(epoch), accounts, computeLimit)

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
