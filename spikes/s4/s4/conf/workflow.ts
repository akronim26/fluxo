// Spike S4: do tweetnacl and @noble/hashes run inside a CRE TS TEE handler (QuickJS/WASM)?
import { cre, type TeeRuntime } from '@chainlink/cre-sdk'
import { sha256 } from '@noble/hashes/sha256'
import nacl from 'tweetnacl'
import { z } from 'zod'

export const configSchema = z.object({
	schedule: z.string(),
})
type Config = z.infer<typeof configSchema>

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const fill = (n: number, v: number) => new Uint8Array(n).fill(v)

export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	// sha256("abc") known-answer test
	const digest = toHex(sha256(new TextEncoder().encode('abc')))
	const shaOk = digest === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

	// Deterministic keypairs (the enclave has no randomness source)
	const alice = nacl.box.keyPair.fromSecretKey(fill(32, 1))
	const bob = nacl.box.keyPair.fromSecretKey(fill(32, 2))
	const nonce = sha256(new TextEncoder().encode('req-1|answer')).slice(0, nacl.box.nonceLength)
	const msg = new TextEncoder().encode('hello enclave')

	const sealed = nacl.box(msg, nonce, bob.publicKey, alice.secretKey)
	const opened = nacl.box.open(sealed, nonce, alice.publicKey, bob.secretKey)
	const boxOk = opened !== null && new TextDecoder().decode(opened) === 'hello enclave'

	// Tampered ciphertext must fail
	sealed[0] ^= 1
	const tamperRejected = nacl.box.open(sealed, nonce, alice.publicKey, bob.secretKey) === null

	runtime.log(`S4 sha256=${digest} shaOk=${shaOk} boxOk=${boxOk} tamperRejected=${tamperRejected}`)

	runtime.usingTheDons()
	return JSON.stringify({ shaOk, boxOk, tamperRejected })
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
