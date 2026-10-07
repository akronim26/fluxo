// Writes the brizo-spend, brizo-settle and brizo-request config.simulation.json files
// from lane B's deploy/devnet.json (the Pool initialised against CRE's simulator
// mock forwarder). Expected keys are listed in docs/HANDOFF-A.md.
//
// Usage (from workflows/): bun run scripts/apply-devnet-config.ts [path/to/devnet.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// CRE simulator mock forwarder on Solana devnet, from the solana-read-write
// building block's config.simulation.json (cre-templates@d0223f3).
const MOCK_FORWARDER_PROGRAM_ID = '7kuEAA3mSC1Tz8gQjnvH7bKFda9xSPRRin9SZbH49cNK'
const MOCK_FORWARDER_STATE = '5Tipz3yhTBdVsDbaBxZkrp7Gjf3brGq5SKkxReefPMP7'
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

const root = join(import.meta.dir, '..')
const src = process.argv[2] ?? join(root, '..', 'deploy', 'devnet.json')
const d = JSON.parse(readFileSync(src, 'utf8'))

const pick = (...keys: string[]): string => {
	for (const k of keys) {
		const v = k.split('.').reduce<any>((o, p) => (o == null ? undefined : o[p]), d)
		if (typeof v === 'string' && v.length > 0) return v
	}
	throw new Error(`deploy/devnet.json is missing ${keys.join(' / ')}`)
}

const solana = {
	chainSelectorName: 'solana-devnet',
	receiverProgramId: pick('programId', 'program_id', 'brizoPool'),
	forwarderState: d.forwarderState ?? d.mockForwarder?.state ?? MOCK_FORWARDER_STATE,
	forwarderProgramId: d.forwarderProgramId ?? d.mockForwarder?.programId ?? MOCK_FORWARDER_PROGRAM_ID,
	pool: pick('pool', 'poolPda', 'pool_pda'),
}

const spend = {
	solana: { ...solana, nullifiers: pick('nullifiers', 'nullifierSet', 'nullifier_set') },
	computeLimit: 300_000,
}
const settle = {
	schedule: '0 */10 * * * *',
	epochSeconds: 600,
	solana: {
		...solana,
		vault: pick('vault'),
		operator: pick('operator', 'operatorTokenAccount'),
		tokenProgram: d.tokenProgram ?? TOKEN_PROGRAM_ID,
	},
	computeLimit: 300_000,
}

writeFileSync(join(root, 'brizo-spend', 'config.simulation.json'), `${JSON.stringify(spend, null, 2)}\n`)
// brizo-request (E15) = brizo-infer's enclave config + brizo-spend's Solana config.
const infer = JSON.parse(readFileSync(join(root, 'brizo-infer', 'config.simulation.json'), 'utf8'))
writeFileSync(
	join(root, 'brizo-request', 'config.simulation.json'),
	`${JSON.stringify({ ...infer, solana: spend.solana, computeLimit: spend.computeLimit }, null, 2)}\n`,
)
writeFileSync(join(root, 'brizo-settle', 'config.simulation.json'), `${JSON.stringify(settle, null, 2)}\n`)
console.log(`wrote brizo-spend, brizo-settle and brizo-request configs from ${src}`)
