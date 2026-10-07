// Local stand-in for the gateway's POST /mailbox/:requestId (lane C owns the real one).
// Stores the sealed answer and, when fixtures/.infer-client.json matches the
// requestId, decrypts it with the test client key to show the round trip works.
//
// Usage (from workflows/): bun run scripts/mock-mailbox.ts   (listens on :8787)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { base64ToBytes } from '../lib/brizo'

const root = join(import.meta.dir, '..')
const port = Number(process.env.PORT ?? 8787)

Bun.serve({
	port,
	async fetch(req) {
		const url = new URL(req.url)
		const m = url.pathname.match(/^\/mailbox\/([0-9a-f]{32})$/)
		if (req.method !== 'POST' || !m) return new Response('not found', { status: 404 })

		const body = (await req.json()) as { requestId: string; ciphertext: string; nonce: string }
		console.log(`mailbox: received ${m[1]} (${body.ciphertext.length} base64 chars)`)

		const clientPath = join(root, 'fixtures', '.infer-client.json')
		if (existsSync(clientPath)) {
			const c = JSON.parse(readFileSync(clientPath, 'utf8'))
			if (c.requestId === m[1]) {
				const opened = nacl.box.open(
					base64ToBytes(body.ciphertext),
					base64ToBytes(body.nonce),
					base64ToBytes(c.enclaveBoxPublicKey),
					base64ToBytes(c.clientSecretKey),
				)
				console.log(opened ? `mailbox: decrypted answer:\n${new TextDecoder().decode(opened)}` : 'mailbox: DECRYPT FAILED')
			}
		}
		return Response.json({ stored: true })
	},
})
console.log(`mock mailbox listening on http://localhost:${port}`)
