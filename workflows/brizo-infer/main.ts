// brizo-infer — Confidential Workflow (handlerInTee), HTTP trigger. Two-step path:
// the gateway runs it only after brizo-spend returned SUCCESS.
//
// Inside the enclave: check the request binding, open the user's envelope, call
// the model with the API key released only into the enclave, seal the answer to
// the user's one-time key and post it to the gateway mailbox. Only
// { requestId, delivered, status } crosses back to the DON.
//
// Payload (docs/HANDOFF-A.md):
//   { requestId: 32 hex, ciphertext: base64, nonce: base64 (24 B),
//     clientPub: base64 (32 B), requestBinding: 64 hex (32 B big-endian) }
import { cre, decodeJson, ok, Runner, type TeeRuntime } from '@chainlink/cre-sdk'
import { z } from 'zod'
import { answerInEnclave, inferConfigShape, inferPayloadShape, mailboxRequest, toHex } from '../lib/infer'

const configSchema = z.object(inferConfigShape)
type Config = z.infer<typeof configSchema>
const payloadSchema = z.object(inferPayloadShape)

type Status = 'delivered' | 'bad_binding' | 'decrypt_failed' | 'bad_envelope' | 'too_long' | 'model_error'

const onInfer = (runtime: TeeRuntime<Config>, payload: { input: Uint8Array }): string => {
	const req = payloadSchema.parse(decodeJson(payload.input))
	const requestId = toHex(req.requestId)
	const outcome = answerInEnclave(runtime, req)

	let delivered = false
	if ('sealed' in outcome) {
		// Still inside the enclave: the request carries only ciphertext sealed to the user.
		const response = new cre.capabilities.HTTPClient()
			.sendRequest(runtime, mailboxRequest(runtime.config, requestId, outcome.sealed, outcome.nonce))
			.result()
		delivered = ok(response)
		if (runtime.config.debugLogs) runtime.log(`${requestId}: mailbox ${delivered ? 'accepted' : 'refused'}`)
	}

	// Cross back to the DON with derived, non-sensitive values only.
	runtime.usingTheDons()
	const status: Status = outcome.status === 'answered' ? 'delivered' : outcome.status
	return JSON.stringify({ requestId, delivered, status })
}

const initWorkflow = (_config: Config) => {
	const http = new cre.capabilities.HTTPCapability()
	return [
		// Simulation accepts an empty authorizedKeys list. A deployment would
		// allow-list the gateway's single shared signing key (SPEC §4.4).
		cre.handlerInTee(http.trigger({}), onInfer, [{ tee: 'nitro', regions: ['us-west-2'] }]),
	]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}

main()
