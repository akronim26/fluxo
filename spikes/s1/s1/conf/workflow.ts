// Spike S1: handlerInTee with an HTTP trigger, simulated with --http-payload.
import { cre, decodeJson, type TeeRuntime } from '@chainlink/cre-sdk'
import { sha256 } from '@noble/hashes/sha256'
import { z } from 'zod'

export const configSchema = z.object({})
type Config = z.infer<typeof configSchema>

type HttpPayload = { input: Uint8Array }

const payloadSchema = z.object({ requestId: z.string().regex(/^[0-9a-f]{32}$/), note: z.string() })

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

export const onHttp = (runtime: TeeRuntime<Config>, payload: HttpPayload): string => {
	const body = payloadSchema.parse(decodeJson(payload.input))
	const digest = toHex(sha256(new TextEncoder().encode(body.requestId + body.note)))
	runtime.log(`S1 in enclave: requestId=${body.requestId} digest=${digest}`)
	runtime.usingTheDons()
	return JSON.stringify({ requestId: body.requestId, digest })
}

export function initWorkflow(_config: Config) {
	const http = new cre.capabilities.HTTPCapability()
	return [
		cre.handlerInTee(http.trigger({}), onHttp, [{ tee: 'nitro', regions: ['us-west-2'] }]),
	]
}
