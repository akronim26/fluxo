import nacl from 'tweetnacl';
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (text: string) => { if (!/^(?:[a-f0-9]{2})+$/i.test(text)) throw new Error('Invalid hex encoding'); return Uint8Array.from(text.match(/../g)!, v => parseInt(v, 16)); };
export const base64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};
export const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export const randomField = () => BigInt(`0x${hex(crypto.getRandomValues(new Uint8Array(31)))}`).toString();
export async function sha256(bytes: Uint8Array) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))); }
export async function requestBinding(id: string, ciphertext: string) { return (BigInt(`0x${hex(await sha256(new Uint8Array([...fromHex(id), ...fromBase64(ciphertext)])))}`) % FIELD).toString(); }
export async function sealQuestion(question: string, enclaveKey: string) {
  const key = fromBase64(enclaveKey); if (key.length !== 32) throw new Error('Invalid enclave public key.');
  const pair = nacl.box.keyPair();
  const id = hex(crypto.getRandomValues(new Uint8Array(16)));
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = new TextEncoder().encode(JSON.stringify({ question, bands: {} }));
  if (plaintext.length > 12_000) throw new Error('The reviewed question is too long.');
  const ciphertext = base64(nacl.box(plaintext, nonce, key, pair.secretKey));
  return { requestId: id, ciphertext, nonce: base64(nonce), clientPub: base64(pair.publicKey), secretKey: pair.secretKey, binding: await requestBinding(id, ciphertext) };
}
export async function openAnswer(answer: { ciphertext: string; nonce: string }, request: { requestId: string; clientPub: string; secretKey: Uint8Array }, enclaveKey: string) {
  const expected = (await sha256(new Uint8Array([...fromHex(request.requestId), ...fromBase64(request.clientPub), ...new TextEncoder().encode('answer')]))).slice(0,24);
  const nonce = fromBase64(answer.nonce);
  if (hex(nonce) !== hex(expected)) throw new Error('The answer nonce does not match this request.');
  const plaintext = nacl.box.open(fromBase64(answer.ciphertext), nonce, fromBase64(enclaveKey), request.secretKey);
  if (!plaintext) throw new Error('The encrypted answer could not be authenticated.');
  const result = JSON.parse(new TextDecoder().decode(plaintext));
  if (result.ok !== true || typeof result.answer !== 'string') throw new Error('The model was unavailable. This credit may already be spent; it will not be retried automatically.');
  return result.answer as string;
}
