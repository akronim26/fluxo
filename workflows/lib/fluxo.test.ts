import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha256'
import nacl from 'tweetnacl'
import {
	answerNonce,
	base64ToBytes,
	BN254_R,
	bytesToBase64,
	bytesToHex,
	computeRequestBinding,
	encodeSettleReport,
	encodeSpendReport,
	hexToBytes,
} from './fluxo'

describe('base64', () => {
	test('matches Buffer for every length 0..64', () => {
		for (let n = 0; n <= 64; n++) {
			const b = nacl.randomBytes(n)
			const ours = bytesToBase64(b)
			expect(ours).toBe(Buffer.from(b).toString('base64'))
			expect(bytesToHex(base64ToBytes(ours))).toBe(bytesToHex(b))
		}
	})
})

describe('binding (D2)', () => {
	test('equals sha256(requestId ‖ ciphertext) mod r, 32 bytes big-endian', () => {
		const requestId = hexToBytes('0123456789abcdef0123456789abcdef')
		const ct = new Uint8Array([1, 2, 3, 4, 5])
		const digest = BigInt('0x' + bytesToHex(sha256(new Uint8Array([...requestId, ...ct]))))
		const expected = (digest % BN254_R).toString(16).padStart(64, '0')
		expect(bytesToHex(computeRequestBinding(requestId, ct))).toBe(expected)
	})
})

describe('nonce (D3)', () => {
	test('first 24 bytes of sha256(requestId ‖ clientPub ‖ "answer")', () => {
		const requestId = new Uint8Array(16).fill(7)
		const clientPub = new Uint8Array(32).fill(9)
		const full = sha256(new Uint8Array([...requestId, ...clientPub, ...new TextEncoder().encode('answer')]))
		expect(bytesToHex(answerNonce(requestId, clientPub))).toBe(bytesToHex(full.slice(0, 24)))
	})
})

describe('FluxoReport (D6)', () => {
	test('Spend (D6 finalize) is 65 bytes: variant 0, nullifier hash, request binding', () => {
		const r = encodeSpendReport(new Uint8Array(32).fill(7), new Uint8Array(32).fill(9))
		expect(r.length).toBe(65)
		expect(r[0]).toBe(0)
		expect(r[1]).toBe(7)
		expect(r[33]).toBe(9)
	})
	test('Settle is variant 1 + u64 LE', () => {
		expect(bytesToHex(encodeSettleReport(0x0102n))).toBe('01' + '0201000000000000')
	})
})
