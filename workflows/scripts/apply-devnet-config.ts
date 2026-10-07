import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const src = process.argv[2] ?? join(root, '..', 'deploy', 'devnet.json')
const d = JSON.parse(readFileSync(src, 'utf8'))

const need = (key: string): string => {
	if (typeof d[key] !== 'string' || !d[key]) throw new Error(`deploy/devnet.json is missing ${key}`)
	return d[key]
}

const solana = {
	chainSelectorName: 'solana-devnet',
	receiverProgramId: need('programId'),
	forwarderState: need('forwarderState'),
	forwarderProgramId: need('forwarderProgramId'),
	pool: need('pool'),
}

const spend = {
	solana: { ...solana, nullifiers: need('nullifiers') },
	computeLimit: 300_000,
}
const settle = {
	schedule: '0 */10 * * * *',
	epochSeconds: 600,
	solana: {
		...solana,
		vault: need('vault'),
		operator: need('operator'),
		tokenProgram: need('tokenProgram'),
	},
	computeLimit: 300_000,
}

writeFileSync(join(root, 'fluxo-spend', 'config.simulation.json'), `${JSON.stringify(spend, null, 2)}\n`)
const infer = JSON.parse(readFileSync(join(root, 'fluxo-infer', 'config.simulation.json'), 'utf8'))
writeFileSync(
	join(root, 'fluxo-request', 'config.simulation.json'),
	`${JSON.stringify({ ...infer, solana: spend.solana, computeLimit: spend.computeLimit }, null, 2)}\n`,
)
writeFileSync(join(root, 'fluxo-settle', 'config.simulation.json'), `${JSON.stringify(settle, null, 2)}\n`)
console.log(`wrote fluxo-spend, fluxo-settle and fluxo-request configs from ${src}`)
