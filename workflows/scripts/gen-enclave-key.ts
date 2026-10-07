import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import nacl from 'tweetnacl'

const root = join(import.meta.dir, '..')
const envPath = join(root, '.env')
const pubPath = join(root, 'enclave-public-key.json')

const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
if (/^SECRET_ENCLAVE_BOX_SK=\S+/m.test(existing)) {
	console.error('SECRET_ENCLAVE_BOX_SK is already set in workflows/.env; not replacing it.')
	process.exit(1)
}
if (/^SECRET_ENCLAVE_BOX_SK=\s*$/m.test(existing)) {
	console.error('workflows/.env has an empty SECRET_ENCLAVE_BOX_SK= line; delete that line and rerun.')
	process.exit(1)
}

const kp = nacl.box.keyPair()
const sk = Buffer.from(kp.secretKey).toString('base64')
const pk = Buffer.from(kp.publicKey).toString('base64')

const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
appendFileSync(envPath, `${prefix}SECRET_ENCLAVE_BOX_SK=${sk}\n`, { mode: 0o600 })
writeFileSync(
	pubPath,
	`${JSON.stringify({ enclaveBoxPublicKey: pk, encoding: 'base64 x25519 (nacl.box)', createdAt: new Date().toISOString() }, null, 2)}\n`,
)
console.log(`Enclave box public key: ${pk}`)
console.log('Secret key appended to workflows/.env as SECRET_ENCLAVE_BOX_SK (not shown).')
