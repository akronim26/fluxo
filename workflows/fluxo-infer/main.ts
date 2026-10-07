import { cre, decodeJson, ok, Runner, type TeeRuntime } from '@chainlink/cre-sdk'
import { z } from 'zod'
import { bytesToHex } from '../lib/fluxo'
import { answerInEnclave, inferConfigShape, inferPayloadShape, mailboxRequest } from '../lib/infer'

const configSchema = z.object(inferConfigShape)
type Config = z.infer<typeof configSchema>
const payloadSchema = z.object(inferPayloadShape)

type Status = 'delivered' | 'bad_binding' | 'decrypt_failed' | 'bad_envelope' | 'too_long' | 'model_error'

const onInfer = (runtime: TeeRuntime<Config>, payload: { input: Uint8Array }): string => {
	const req = payloadSchema.parse(decodeJson(payload.input))
	const requestId = bytesToHex(req.requestId)
	const outcome = answerInEnclave(runtime, req)

	let delivered = false
	if ('sealed' in outcome) {
		const response = new cre.capabilities.HTTPClient()
			.sendRequest(runtime, mailboxRequest(runtime.config, requestId, outcome.sealed, outcome.nonce))
			.result()
		delivered = ok(response)
		if (runtime.config.debugLogs) runtime.log(`${requestId}: mailbox ${delivered ? 'accepted' : 'refused'}`)
	}

	runtime.usingTheDons()
	const status: Status = outcome.status === 'answered' ? 'delivered' : outcome.status
	return JSON.stringify({ requestId, delivered, status })
}

const initWorkflow = (_config: Config) => {
	const http = new cre.capabilities.HTTPCapability()
	return [
		cre.handlerInTee(http.trigger({}), onInfer, [{ tee: 'nitro', regions: ['us-west-2'] }]),
	]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}

main()
