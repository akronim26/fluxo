import {
	bytesToHex as sdkBytesToHex,
	calculateAccountsHash,
	encodeForwarderReport,
	getNetwork,
	prepareSolanaReportRequest,
	type Runtime,
	type SolanaAccountMeta,
	SolanaClient,
	SolanaTxStatus,
	solanaAccountMeta,
	solanaAccountMetasToJson,
	solanaAddressToBytes,
} from '@chainlink/cre-sdk'
import { address } from '@solana/addresses'
import { getBase58Decoder } from '@solana/codecs'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'

const BASE58_DECODER = getBase58Decoder()
const FORWARDER_SEED = new TextEncoder().encode('forwarder')
const PENDING_SEED = new TextEncoder().encode('pending')

export const MAX_COMPUTE_LIMIT = 300_000
export const MAX_REPORT_BYTES = 265

export const base58Address = z.string().refine(
	(value) => {
		try {
			address(value)
			return true
		} catch {
			return false
		}
	},
	{ message: 'Invalid base58-encoded Solana address' },
)

export const forwarderConfigSchema = z.object({
	chainSelectorName: z.string(),
	receiverProgramId: base58Address,
	forwarderState: base58Address,
	forwarderProgramId: base58Address,
})
export type ForwarderConfig = z.infer<typeof forwarderConfigSchema>

export const deriveForwarderAuthority = (c: ForwarderConfig): string => {
	const [authority] = PublicKey.findProgramAddressSync(
		[FORWARDER_SEED, new PublicKey(c.forwarderState).toBytes(), new PublicKey(c.receiverProgramId).toBytes()],
		new PublicKey(c.forwarderProgramId),
	)
	return authority.toBase58()
}

export const forwarderAccounts = (c: ForwarderConfig, receiverAccounts: SolanaAccountMeta[]): SolanaAccountMeta[] => [
	solanaAccountMeta(c.forwarderState, true),
	solanaAccountMeta(deriveForwarderAuthority(c)),
	...receiverAccounts,
]

export const pendingAddress = (programId: string, pool: string, nullifierHash: Uint8Array): string =>
	PublicKey.findProgramAddressSync(
		[PENDING_SEED, new PublicKey(pool).toBytes(), nullifierHash],
		new PublicKey(programId),
	)[0].toBase58()

const FLUXO_POOL_ERRORS = [
	'InvalidForwarderProgram', 'MismatchedForwarderProgram', 'InvalidForwarderAuthority', 'InvalidReport',
	'UnknownRoot', 'InvalidProof', 'NullifierUsed', 'NullifierSetFull', 'TreeFull', 'OverSpent',
	'InsufficientVault', 'InvalidConfig', 'InvalidCommitment', 'InvalidTokenAccount', 'InvalidTokenProgram',
	'PoseidonFailed', 'NotStaged', 'BindingMismatch',
]

export const describeWriteError = (raw: string): string => {
	const m = raw.match(/custom program error: (0x[0-9a-fA-F]+)/)
	if (!m) return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
	const name = FLUXO_POOL_ERRORS[parseInt(m[1], 16) - 6000]
	return name ? `${name} (${m[1]})` : `custom program error ${m[1]}`
}

export type WriteResult = { txStatus: 'SUCCESS'; txSignature: string } | { txStatus: string; error: string }

export const writeFluxoReport = (
	runtime: Runtime<unknown>,
	c: ForwarderConfig,
	payload: Uint8Array,
	accounts: SolanaAccountMeta[],
	computeLimit: number,
): WriteResult => {
	if (computeLimit > MAX_COMPUTE_LIMIT) throw new Error(`computeLimit above ${MAX_COMPUTE_LIMIT}`)

	const network = getNetwork({ chainFamily: 'solana', chainSelectorName: c.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`Network not found: ${c.chainSelectorName}`)

	const forwarderReport = encodeForwarderReport({ accountHash: calculateAccountsHash(accounts), payload })
	if (forwarderReport.length > MAX_REPORT_BYTES) {
		throw new Error(`report is ${forwarderReport.length} bytes, limit ${MAX_REPORT_BYTES}`)
	}

	const report = runtime.report(prepareSolanaReportRequest(forwarderReport)).result()

	const resp = new SolanaClient(network.chainSelector.selector)
		.writeReport(runtime, {
			remainingAccounts: solanaAccountMetasToJson(accounts),
			receiver: sdkBytesToHex(solanaAddressToBytes(c.receiverProgramId)),
			computeConfig: { computeLimit },
			report,
		})
		.result()

	if (resp.txStatus !== SolanaTxStatus.SUCCESS) {
		return { txStatus: String(resp.txStatus), error: describeWriteError(resp.errorMessage || 'write failed') }
	}
	const txSignature = resp.txSignature ? BASE58_DECODER.decode(resp.txSignature) : ''
	if (!txSignature) return { txStatus: 'NO_SIGNATURE', error: 'write reported success without a signature' }
	return { txStatus: 'SUCCESS', txSignature }
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
