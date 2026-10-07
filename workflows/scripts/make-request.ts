// Builds one real Brizo request the way the browser/SDK does, against the live
// devnet pool — no fixtures, no shortcuts:
//   1. reads the Leaves and Tree accounts over RPC and rebuilds the Poseidon tree;
//   2. seals {question, bands} to the enclave public key with a fresh client key;
//   3. requestBinding = BE(sha256(requestId ‖ ciphertext)) mod r (HANDOFF-A D2);
//   4. proves the credit (circuits/build/credit.wasm + credit_final.zkey) and
//      checks it with verification_key.json;
//   5. writes, under fixtures/requests/<requestId>/:
//        stage.json   input for brizo_pool.stage_spend (scripts/stage-spend.ts)
//        spend.json   brizo-spend HTTP payload
//        infer.json   brizo-infer HTTP payload
//        ask.json     the gateway's POST /api/ask body (snarkjs proof + public signals)
//        client.json  the one-time client secret key (gitignored) to open the answer
//
// Usage (from workflows/; runs under Node because snarkjs's worker threads hang in Bun):
//   npx tsx scripts/make-request.ts --i <credit index> --relayer <base58> \
//     [--note path/to/note.json] [--question "..."]
// note.json = { "secret": "<decimal>", "nk": "<decimal>", "leafIndex": <n> }.
// Without --note it uses lane C's published test note (secret 123, nk 456), which
// is leaf 0 of the devnet pool. Each (note, i) pair can be spent once.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { buildPoseidon } from 'circomlibjs'
import { groth16 } from 'snarkjs'
import nacl from 'tweetnacl'
import { proofToSolanaCompressed } from '../../circuits/lib/protocol.mjs'
import { bytesToBase64, bytesToHex, computeRequestBinding } from '../lib/brizo'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(root, '..')
const { values: args } = parseArgs({
	options: {
		i: { type: 'string' },
		relayer: { type: 'string' },
		note: { type: 'string' },
		question: { type: 'string' },
	},
})
if (args.i === undefined || !args.relayer) {
	console.error('usage: make-request.ts --i <credit index 0..199> --relayer <base58> [--note file] [--question text]')
	process.exit(1)
}
const i = BigInt(args.i)
if (i < 0n || i >= 200n) throw new Error('--i must be 0..199')

const note = args.note
	? JSON.parse(readFileSync(args.note, 'utf8'))
	: { secret: '123', nk: '456', leafIndex: 0 }
const deploy = JSON.parse(readFileSync(join(repo, 'deploy', 'devnet.json'), 'utf8'))
const { enclaveBoxPublicKey } = JSON.parse(readFileSync(join(root, 'enclave-public-key.json'), 'utf8'))

// ─── On-chain state ─────────────────────────────────────────

const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || deploy.rpcUrl
const accountData = async (address: string): Promise<Buffer> => {
	const res = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'getAccountInfo',
			params: [address, { encoding: 'base64', commitment: 'confirmed' }],
		}),
	})
	const json: any = await res.json()
	if (!json.result?.value) throw new Error(`account ${address} not found`)
	return Buffer.from(json.result.value.data[0], 'base64')
}

const poseidon = await buildPoseidon()
const H = (a: bigint, b: bigint): bigint => poseidon.F.toObject(poseidon([a, b]))
const fromBE = (b: Uint8Array) => BigInt(`0x${Buffer.from(b).toString('hex') || '0'}`)
const toBE32 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex')

// Leaves: 8-byte discriminator, count u32, pad u32, leaves[1024][32].
const leavesData = await accountData(deploy.leaves)
const count = leavesData.readUInt32LE(8)
const leaves = Array.from({ length: count }, (_, k) => fromBE(leavesData.subarray(16 + 32 * k, 48 + 32 * k)))

const commitment = H(BigInt(note.secret), BigInt(note.nk))
if (leaves[note.leafIndex] !== commitment) {
	throw new Error(`leaf ${note.leafIndex} on-chain is not this note's commitment`)
}

// Merkle path, depth 10; empty leaf 0, zeros[d+1] = H(zeros[d], zeros[d]).
const DEPTH = 10
const pathElements: string[] = []
const pathIndices: string[] = []
let level = [...leaves]
let zero = 0n
let idx = note.leafIndex
for (let d = 0; d < DEPTH; d++) {
	pathElements.push(String(level[idx ^ 1] ?? zero))
	pathIndices.push(String(idx & 1))
	const next: bigint[] = []
	for (let k = 0; k < Math.max(1, Math.ceil(level.length / 2)); k++) next.push(H(level[2 * k] ?? zero, level[2 * k + 1] ?? zero))
	level = next
	zero = H(zero, zero)
	idx >>= 1
}
const merkleRoot = level[0]

// Tree: disc 8, next_index u32, current_root_index u32, filled_subtrees[10], zeros[10], roots[32].
const treeData = await accountData(deploy.tree)
const rootsOffset = 8 + 4 + 4 + 32 * 10 + 32 * 10
const roots = Array.from({ length: 32 }, (_, k) => fromBE(treeData.subarray(rootsOffset + 32 * k, rootsOffset + 32 * (k + 1))))
if (!roots.includes(merkleRoot)) throw new Error('rebuilt root is not in the on-chain root history')

// ─── Envelope ───────────────────────────────────────────────

const question =
	args.question ??
	'A person in their 30s with ferritin below the usual reference range is flying westbound across 7 time zones in about 2 weeks. How should they adjust training and diet?'
const envelope = { question, bands: { ageBand: '30s', ferritin: 'below reference range', travel: 'westbound, -7h, ~2 weeks away' } }
const client = nacl.box.keyPair()
const requestId = nacl.randomBytes(16)
const nonce = nacl.randomBytes(nacl.box.nonceLength)
const ciphertext = nacl.box(
	new TextEncoder().encode(JSON.stringify(envelope)),
	nonce,
	Uint8Array.from(Buffer.from(enclaveBoxPublicKey, 'base64')),
	client.secretKey,
)
const binding = computeRequestBinding(requestId, ciphertext)

// ─── Proof ──────────────────────────────────────────────────

const nullifierHash = H(BigInt(note.nk), i)
const input = {
	secret: String(note.secret),
	nk: String(note.nk),
	pathElements,
	pathIndices,
	i: String(i),
	root: String(merkleRoot),
	nullifierHash: String(nullifierHash),
	requestBinding: String(fromBE(binding)),
}
const build = join(repo, 'circuits', 'build')
const started = performance.now()
const { proof, publicSignals } = await groth16.fullProve(input, join(build, 'credit.wasm'), join(build, 'credit_final.zkey'))
const provingMs = Math.round(performance.now() - started)
const vk = JSON.parse(readFileSync(join(build, 'verification_key.json'), 'utf8'))
if (!(await groth16.verify(vk, publicSignals, proof))) throw new Error('proof did not verify')

const stage = proofToSolanaCompressed(proof, publicSignals)
if (stage.root !== toBE32(merkleRoot).toString('hex') || stage.requestBinding !== bytesToHex(binding)) {
	throw new Error('public signals do not match the request')
}

// ─── Output ─────────────────────────────────────────────────

const id = bytesToHex(requestId)
const dir = join(root, 'fixtures', 'requests', id)
mkdirSync(dir, { recursive: true })
const write = (name: string, v: unknown) => writeFileSync(join(dir, name), `${JSON.stringify(v, null, 2)}\n`)
write('stage.json', stage)
write('spend.json', { requestId: id, nullifierHash: stage.nullifierHash, requestBinding: stage.requestBinding, relayer: args.relayer })
write('infer.json', {
	requestId: id,
	ciphertext: bytesToBase64(ciphertext),
	nonce: bytesToBase64(nonce),
	clientPub: bytesToBase64(client.publicKey),
	requestBinding: bytesToHex(binding),
})
// Browser-style body for the gateway's POST /api/ask (SPEC §7).
write('ask.json', {
	requestId: id,
	ciphertext: bytesToBase64(ciphertext),
	nonce: bytesToBase64(nonce),
	clientPub: bytesToBase64(client.publicKey),
	proof,
	publicSignals,
})
write('client.json', { requestId: id, clientSecretKey: bytesToBase64(client.secretKey), enclaveBoxPublicKey })
console.log(JSON.stringify({ requestId: id, dir: `fixtures/requests/${id}`, i: String(i), nullifierHash: stage.nullifierHash, provingMs }))
process.exit(0)
