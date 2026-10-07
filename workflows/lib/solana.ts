// Solana write path shared by brizo-spend and brizo-settle. Mirrors the
// encoding in the CRE solana-read-write building block's generated binding
// (contracts/ts/generated/KvStoreReceiver.ts): Borsh payload → forwarder report
// (account hash + payload) → runtime.report → SolanaClient.writeReport.
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

// Default CRE limit for a Solana write (`cre workflow limits export`). The
// simulator refuses anything higher. See docs/HANDOFF-A.md D1.
export const MAX_COMPUTE_LIMIT = 300_000
// Default CRE limit for a Solana report (forwarder report bytes).
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

// PDA ["forwarder", forwarderState, receiverProgramId] under the forwarder program.
// Uses web3.js's synchronous derivation: @solana/addresses hashes with
// crypto.subtle, which does not exist in the CRE runtime.
export const deriveForwarderAuthority = (c: ForwarderConfig): string => {
	const [authority] = PublicKey.findProgramAddressSync(
		[FORWARDER_SEED, new PublicKey(c.forwarderState).toBytes(), new PublicKey(c.receiverProgramId).toBytes()],
		new PublicKey(c.forwarderProgramId),
	)
	return authority.toBase58()
}

/** [forwarderState (w), forwarderAuthority, ...receiver accounts] — order is hashed into the report. */
export const forwarderAccounts = (c: ForwarderConfig, receiverAccounts: SolanaAccountMeta[]): SolanaAccountMeta[] => [
	solanaAccountMeta(c.forwarderState, true),
	solanaAccountMeta(deriveForwarderAuthority(c)),
	...receiverAccounts,
]

// brizo_pool's Anchor error codes (6000 + index, programs/brizo_pool/src/lib.rs BrizoError).
const BRIZO_POOL_ERRORS = [
	'InvalidForwarderProgram', 'MismatchedForwarderProgram', 'InvalidForwarderAuthority', 'InvalidReport',
	'UnknownRoot', 'InvalidProof', 'NullifierUsed', 'NullifierSetFull', 'TreeFull', 'OverSpent',
	'InsufficientVault', 'InvalidConfig', 'InvalidCommitment', 'InvalidTokenAccount', 'InvalidTokenProgram',
	'PoseidonFailed', 'NotStaged', 'BindingMismatch',
]

/** Turns the capability's raw RPC error into e.g. "NullifierUsed (0x1776)" when it carries a program error code. */
export const describeWriteError = (raw: string): string => {
	const m = raw.match(/custom program error: (0x[0-9a-fA-F]+)/)
	if (!m) return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
	const name = BRIZO_POOL_ERRORS[parseInt(m[1], 16) - 6000]
	return name ? `${name} (${m[1]})` : `custom program error ${m[1]}`
}

export type WriteResult = { txStatus: 'SUCCESS'; txSignature: string } | { txStatus: string; error: string }

/**
 * Writes a Borsh BrizoReport payload to brizo_pool.on_report via the forwarder.
 * Returns a refusal (never throws) when the chain write does not succeed, so the
 * caller can report it to the gateway.
 */
export const writeBrizoReport = (
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
