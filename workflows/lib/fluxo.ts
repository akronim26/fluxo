import { sha256 } from '@noble/hashes/sha256'
import { z } from 'zod'

export const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

export const hexToBytes = (hex: string): Uint8Array => {
	const h = hex.startsWith('0x') ? hex.slice(2) : hex
	if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('invalid hex')
	const out = new Uint8Array(h.length / 2)
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
	return out
}

export const bytesToHex = (b: Uint8Array): string =>
	Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = (() => {
	const t = new Int16Array(128).fill(-1)
	for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i
	return t
})()

export const bytesToBase64 = (b: Uint8Array): string => {
	let out = ''
	for (let i = 0; i < b.length; i += 3) {
		const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
		out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
		out += i + 1 < b.length ? B64[(n >> 6) & 63] : '='
		out += i + 2 < b.length ? B64[n & 63] : '='
	}
	return out
}

export const base64ToBytes = (s: string): Uint8Array => {
	const clean = s.replace(/=+$/, '')
	if (clean.length % 4 === 1) throw new Error('invalid base64')
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
	let buf = 0
	let bits = 0
	let o = 0
	for (let i = 0; i < clean.length; i++) {
		const c = clean.charCodeAt(i)
		const v = c < 128 ? B64_INDEX[c] : -1
		if (v < 0) throw new Error('invalid base64')
		buf = (buf << 6) | v
		bits += 6
		if (bits >= 8) {
			bits -= 8
			out[o++] = (buf >> bits) & 0xff
		}
	}
	return out
}

export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
	let o = 0
	for (const p of parts) {
		out.set(p, o)
		o += p.length
	}
	return out
}

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
	if (a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
	return diff === 0
}

const bytesToBigIntBE = (b: Uint8Array): bigint => {
	let n = 0n
	for (const x of b) n = (n << 8n) | BigInt(x)
	return n
}

export const bigIntToBytes32BE = (n: bigint): Uint8Array => {
	if (n < 0n || n >= 1n << 256n) throw new Error('value out of range for 32 bytes')
	const out = new Uint8Array(32)
	for (let i = 31; i >= 0; i--) {
		out[i] = Number(n & 0xffn)
		n >>= 8n
	}
	return out
}

const utf8 = (s: string) => new TextEncoder().encode(s)

export const computeRequestBinding = (requestId: Uint8Array, ciphertext: Uint8Array): Uint8Array =>
	bigIntToBytes32BE(bytesToBigIntBE(sha256(concatBytes(requestId, ciphertext))) % BN254_R)

export const answerNonce = (requestId: Uint8Array, clientPub: Uint8Array): Uint8Array =>
	sha256(concatBytes(requestId, clientPub, utf8('answer'))).slice(0, 24)

export const hexOfBytes = (n: number) =>
	z
		.string()
		.regex(new RegExp(`^(0x)?[0-9a-fA-F]{${n * 2}}$`), `expected ${n} bytes of hex`)
		.transform((s) => hexToBytes(s))

export const base64OfBytes = (n?: number) =>
	z.string().transform((s, ctx) => {
		try {
			const b = base64ToBytes(s)
			if (n !== undefined && b.length !== n) throw new Error()
			return b
		} catch {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: `expected base64${n ? ` of ${n} bytes` : ''}` })
			return z.NEVER
		}
	})

export const fieldElementHex = hexOfBytes(32).refine((b) => bytesToBigIntBE(b) < BN254_R, {
	message: 'not a canonical BN254 field element',
})

export const SPEND_VARIANT = 0
export const SETTLE_VARIANT = 1

const expectLen = (name: string, b: Uint8Array, n: number) => {
	if (b.length !== n) throw new Error(`${name} must be ${n} bytes, got ${b.length}`)
}

export const encodeSpendReport = (nullifierHash: Uint8Array, requestBinding: Uint8Array): Uint8Array => {
	expectLen('nullifierHash', nullifierHash, 32)
	expectLen('requestBinding', requestBinding, 32)
	return concatBytes(new Uint8Array([SPEND_VARIANT]), nullifierHash, requestBinding)
}

export const encodeSettleReport = (epoch: bigint): Uint8Array => {
	if (epoch < 0n || epoch >= 1n << 64n) throw new Error('epoch out of u64 range')
	const out = new Uint8Array(9)
	out[0] = SETTLE_VARIANT
	let e = epoch
	for (let i = 1; i < 9; i++) {
		out[i] = Number(e & 0xffn)
		e >>= 8n
	}
	return out
}
