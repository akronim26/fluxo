// Enclave-side request handling shared by brizo-infer (two-step path) and
// brizo-request (E15 single workflow). Everything here takes a TeeRuntime and
// must only be called inside a handlerInTee callback: it touches the enclave box
// key, the model API key, the decrypted question and the plaintext answer.
// Its result carries only derived values and ciphertext sealed to the user.
import { cre, ok, type TeeRuntime, text } from '@chainlink/cre-sdk'
import nacl from 'tweetnacl'
import { z } from 'zod'
import {
	answerNonce,
	base64OfBytes,
	base64ToBytes,
	bytesEqual,
	bytesToBase64,
	computeRequestBinding,
	fieldElementHex,
	hexOfBytes,
} from './brizo'

// z.string().url() relies on URL, which QuickJS doesn't provide.
export const httpUrl = z.string().regex(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/, 'expected an http(s) URL')

export const inferConfigShape = {
	// Gateway base URL; answers go to `${mailboxBaseUrl}/mailbox/${requestId}`.
	// From config, never from the payload, so a caller can't redirect the answer.
	mailboxBaseUrl: httpUrl,
	model: z.object({
		// OpenAI-compatible chat completions endpoint (OpenRouter by default).
		url: httpUrl,
		model: z.string(),
		// CRE's HTTP action timeout is 10 s; keep answers short enough to finish.
		maxTokens: z.number().int().positive().max(1000),
		// Optional OpenRouter provider routing, e.g. { sort: 'throughput' }.
		provider: z.record(z.unknown()).optional(),
	}),
	systemPrompt: z.string().min(1),
	// SPEC §4.1: ≤ 4,000 input tokens, enforced as ≤ 12,000 characters.
	maxQuestionChars: z.number().int().positive().max(12_000),
	secretIds: z.object({
		modelApiKey: z.string(),
		enclaveBoxSk: z.string(),
	}),
	// Simulation only. Logs never include secrets, plaintext or ciphertext, but
	// must still be off for any deployment (CRE skill rule).
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

// SPEC §7: the envelope plaintext is { question, bands }.
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

/** Refusals happen before the model is called; `answered`/`model_error` carry a sealed body. */
export type EnclaveOutcome =
	| { status: 'bad_binding' | 'decrypt_failed' | 'bad_envelope' | 'too_long' }
	| { status: 'answered' | 'model_error'; sealed: Uint8Array; nonce: Uint8Array }

const utf8 = (s: string) => new TextEncoder().encode(s)
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b)
export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

// Models sometimes wrap the requested JSON in ```json fences even with
// response_format set. Return the bare JSON object when the content holds one
// that parses; otherwise return the text unchanged (the browser shows it as
// plain text, SPEC §6).
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

	// A timeout (CRE's 10 s HTTP limit) surfaces as a thrown error; treat it as a
	// model failure so the user still gets a sealed notice.
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

/**
 * Inside the enclave: check the binding, open the envelope, enforce the cap, call
 * the model with the enclave-only API key and seal the answer (or a model-error
 * notice) to the user's one-time key.
 */
export const answerInEnclave = <C extends InferConfig>(runtime: TeeRuntime<C>, req: InferRequest): EnclaveOutcome => {
	const cfg = runtime.config
	const id = toHex(req.requestId)
	const log = (msg: string) => {
		if (cfg.debugLogs) runtime.log(`${id}: ${msg}`)
	}

	// 1. The proof paid for exactly this ciphertext.
	if (!bytesEqual(computeRequestBinding(req.requestId, req.ciphertext), req.requestBinding)) {
		log('binding mismatch')
		return { status: 'bad_binding' }
	}

	// 2. Open the envelope with the enclave box key.
	const boxSk = base64ToBytes(runtime.getSecret({ id: cfg.secretIds.enclaveBoxSk }).result().value.trim())
	if (boxSk.length !== nacl.box.secretKeyLength) throw new Error('enclave box key has the wrong length')
	const opened = nacl.box.open(req.ciphertext, req.nonce, req.clientPub, boxSk)
	if (!opened) {
		log('envelope did not open')
		return { status: 'decrypt_failed' }
	}

	// 3. Character cap on the whole plaintext (question and bands).
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

	// 4. Model call with the key released only into the enclave.
	const apiKey = runtime.getSecret({ id: cfg.secretIds.modelApiKey }).result().value.trim()
	const answer = callModel(runtime, apiKey, envelope)
	log(`model ${answer ? `ok (finish=${answer.finishReason})` : 'failed'}`)

	// 5. Seal to the user's one-time key (D3 nonce).
	const body = answer
		? { ok: true, answer: answer.content, finishReason: answer.finishReason, model: cfg.model.model }
		: { ok: false, error: 'model_unavailable' }
	const nonce = answerNonce(req.requestId, req.clientPub)
	const sealed = nacl.box(utf8(JSON.stringify(body)), nonce, req.clientPub, boxSk)
	return { status: answer ? 'answered' : 'model_error', sealed, nonce }
}

/** JSON body the gateway mailbox accepts at POST /mailbox/:requestId. */
export const mailboxRequest = (cfg: InferConfig, requestIdHex: string, sealed: Uint8Array, nonce: Uint8Array) => ({
	url: `${cfg.mailboxBaseUrl.replace(/\/+$/, '')}/mailbox/${requestIdHex}`,
	method: 'POST',
	multiHeaders: { 'Content-Type': { values: ['application/json'] } },
	body: bytesToBase64(
		utf8(JSON.stringify({ requestId: requestIdHex, ciphertext: bytesToBase64(sealed), nonce: bytesToBase64(nonce) })),
	),
	cacheSettings: { store: false },
})
