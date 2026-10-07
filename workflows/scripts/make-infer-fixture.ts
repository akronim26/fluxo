import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { bytesToBase64, bytesToHex, computeRequestBinding } from '../lib/fluxo'

const root = join(import.meta.dir, '..')
const { enclaveBoxPublicKey } = JSON.parse(readFileSync(join(root, 'enclave-public-key.json'), 'utf8'))
const enclavePub = Uint8Array.from(Buffer.from(enclaveBoxPublicKey, 'base64'))

const question =
	process.argv[2] ??
	'A person in their 30s with ferritin below the usual reference range is flying westbound across 7 time zones in about 2 weeks. How should they adjust training and diet before and after the trip?'

const envelope = {
	question,
	bands: { ageBand: '30s', ferritin: 'below reference range', travel: 'westbound, -7h, ~2 weeks away' },
}

const client = nacl.box.keyPair()
const requestId = nacl.randomBytes(16)
const nonce = nacl.randomBytes(nacl.box.nonceLength)
const ciphertext = nacl.box(new TextEncoder().encode(JSON.stringify(envelope)), nonce, enclavePub, client.secretKey)
const requestBinding = computeRequestBinding(requestId, ciphertext)

const payload = {
	requestId: bytesToHex(requestId),
	ciphertext: bytesToBase64(ciphertext),
	nonce: bytesToBase64(nonce),
	clientPub: bytesToBase64(client.publicKey),
	requestBinding: bytesToHex(requestBinding),
}

mkdirSync(join(root, 'fixtures'), { recursive: true })
writeFileSync(join(root, 'fixtures', 'infer.json'), `${JSON.stringify(payload, null, 2)}\n`)
writeFileSync(
	join(root, 'fixtures', '.infer-client.json'),
	`${JSON.stringify({ requestId: payload.requestId, clientSecretKey: bytesToBase64(client.secretKey), enclaveBoxPublicKey }, null, 2)}\n`,
)
console.log(`wrote fixtures/infer.json for requestId ${payload.requestId}`)
