import { cre, ok, type TeeRuntime, text } from '@chainlink/cre-sdk'
import nacl from 'tweetnacl'
import { z } from 'zod'
import {
	answerNonce,
	base64OfBytes,
	base64ToBytes,
	bytesEqual,
	bytesToBase64,
	bytesToHex,
	computeRequestBinding,
	fieldElementHex,
	hexOfBytes,
} from './fluxo'

export const httpUrl = z.string().regex(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/, 'expected an http(s) URL')

export const inferConfigShape = {
	mailboxBaseUrl: httpUrl,
	model: z.object({
		url: httpUrl,
		model: z.string(),
		maxTokens: z.number().int().positive().max(1000),
		provider: z.record(z.unknown()).optional(),
	}),
	systemPrompt: z.string().min(1),
	maxQuestionChars: z.number().int().positive().max(12_000),
	secretIds: z.object({
		modelApiKey: z.string(),
		enclaveBoxSk: z.string(),
	}),
	debugLogs: z.boolean(),
}
const inferConfigSchema = z.object(inferConfigShape)
export type InferConfig = z.infer<typeof inferConfigSchema>

export const inferPayloadShape = {
	requestId: hexOfBytes(16),
	ciphertext: base64OfBytes(),
	nonce: base64OfBytes(nacl.box.nonceLength),
	clientPub: base64OfBytes(nacl.box.publicKeyLength),
	requestBinding: fieldElementHex,
}
const inferPayloadSchema = z.object(inferPayloadShape)
export type InferRequest = z.infer<typeof inferPayloadSchema>

const envelopeSchema = z.object({
	question: z.string().min(1),
	bands: z.record(z.unknown()).optional(),
})
type Envelope = z.infer<typeof envelopeSchema>

const modelResponseSchema = z.object({
	choices: z
		.array(
			z.object({
				message: z.object({ content: z.string().nullable() }),
				finish_reason: z.string().nullable().optional(),
			}),
		)
		.min(1),
})

export type EnclaveOutcome =
	| { status: 'bad_binding' | 'decrypt_failed' | 'bad_envelope' | 'too_long' }
	| { status: 'answered' | 'model_error'; sealed: Uint8Array; nonce: Uint8Array }

const utf8 = (s: string) => new TextEncoder().encode(s)
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b)

const normaliseJson = (content: string): string => {
	const start = content.indexOf('{')
	const end = content.lastIndexOf('}')
	if (start < 0 || end <= start) return content
	const candidate = content.slice(start, end + 1)
	try {
		JSON.parse(candidate)
		return candidate
	} catch {
		return content
	}
}

const callModel = <C extends InferConfig>(runtime: TeeRuntime<C>, apiKey: string, envelope: Envelope) => {
	const { model } = runtime.config
	const userContent =
		envelope.bands && Object.keys(envelope.bands).length > 0
			? `${envelope.question}\n\nGeneralised context (bands, not exact values): ${JSON.stringify(envelope.bands)}`
			: envelope.question

	let response
	try {
		response = new cre.capabilities.HTTPClient()
			.sendRequest(runtime, {
				url: model.url,
				method: 'POST',
				multiHeaders: {
					Authorization: { values: [`Bearer ${apiKey}`] },
					'Content-Type': { values: ['application/json'] },
				},
				body: bytesToBase64(
					utf8(
						JSON.stringify({
							model: model.model,
							max_tokens: model.maxTokens,
							...(model.provider ? { provider: model.provider } : {}),
							response_format: { type: 'json_object' },
							messages: [
								{ role: 'system', content: runtime.config.systemPrompt },
								{ role: 'user', content: userContent },
							],
						}),
					),
				),
				cacheSettings: { store: false },
			})
			.result()
	} catch {
		return null
	}

	if (!ok(response)) return null
	try {
		const parsed = modelResponseSchema.safeParse(JSON.parse(text(response)))
		if (!parsed.success) return null
		const choice = parsed.data.choices[0]
		return { content: normaliseJson(choice.message.content ?? ''), finishReason: choice.finish_reason ?? null }
	} catch {
		return null
	}
}

export const answerInEnclave = <C extends InferConfig>(runtime: TeeRuntime<C>, req: InferRequest): EnclaveOutcome => {
	const cfg = runtime.config
	const id = bytesToHex(req.requestId)
	const log = (msg: string) => {
		if (cfg.debugLogs) runtime.log(`${id}: ${msg}`)
	}

	if (!bytesEqual(computeRequestBinding(req.requestId, req.ciphertext), req.requestBinding)) {
		log('binding mismatch')
		return { status: 'bad_binding' }
	}

	const boxSk = base64ToBytes(runtime.getSecret({ id: cfg.secretIds.enclaveBoxSk }).result().value.trim())
	if (boxSk.length !== nacl.box.secretKeyLength) throw new Error('enclave box key has the wrong length')
	const opened = nacl.box.open(req.ciphertext, req.nonce, req.clientPub, boxSk)
	if (!opened) {
		log('envelope did not open')
		return { status: 'decrypt_failed' }
	}

	const plaintext = fromUtf8(opened)
	if (plaintext.length > cfg.maxQuestionChars) {
		log('over the character cap')
		return { status: 'too_long' }
	}
	let envelope: Envelope
	try {
		envelope = envelopeSchema.parse(JSON.parse(plaintext))
	} catch {
		log('envelope is not {question, bands}')
		return { status: 'bad_envelope' }
	}

	const apiKey = runtime.getSecret({ id: cfg.secretIds.modelApiKey }).result().value.trim()
	const answer = callModel(runtime, apiKey, envelope)
	log(`model ${answer ? `ok (finish=${answer.finishReason})` : 'failed'}`)

	const body = answer
		? { ok: true, answer: answer.content, finishReason: answer.finishReason, model: cfg.model.model }
		: { ok: false, error: 'model_unavailable' }
	const nonce = answerNonce(req.requestId, req.clientPub)
	const sealed = nacl.box(utf8(JSON.stringify(body)), nonce, req.clientPub, boxSk)
	return { status: answer ? 'answered' : 'model_error', sealed, nonce }
}

export const mailboxRequest = (cfg: InferConfig, requestIdHex: string, sealed: Uint8Array, nonce: Uint8Array) => ({
	url: `${cfg.mailboxBaseUrl.replace(/\/+$/, '')}/mailbox/${requestIdHex}`,
	method: 'POST',
	multiHeaders: { 'Content-Type': { values: ['application/json'] } },
	body: bytesToBase64(
		utf8(JSON.stringify({ requestId: requestIdHex, ciphertext: bytesToBase64(sealed), nonce: bytesToBase64(nonce) })),
	),
	cacheSettings: { store: false },
})
