import { z } from 'zod';
import { poseidon2 } from 'poseidon-lite/poseidon2';
import { base64, FIELD, fromBase64, randomField } from './crypto';

const field = z.string().regex(/^\d{1,77}$/).refine(v => BigInt(v) < FIELD);
export const noteSchema = z.object({
  version: z.literal(1), pool: z.string().min(32).max(44), secret: field, nk: field,
  commitment: field, nextI: z.number().int().min(0).max(200),
  leafIndex: z.number().int().min(0).max(1023).nullable(),
  depositTx: z.string().optional(),
}).refine(n => poseidon2([BigInt(n.secret), BigInt(n.nk)]).toString() === n.commitment, 'Invalid credit note');
export type CreditNote = z.infer<typeof noteSchema>;
const key = (pool: string) => `fluxo:notes:v1:${pool}`;
export function newNote(pool: string): CreditNote {
  const secret = randomField(), nk = randomField();
  return { version: 1, pool, secret, nk, commitment: poseidon2([BigInt(secret), BigInt(nk)]).toString(), nextI: 0, leafIndex: null };
}
export function readNotes(pool: string): CreditNote[] {
  const value = localStorage.getItem(key(pool));
  if (!value) return [];
  return z.array(noteSchema).max(1024).parse(JSON.parse(value));
}
export function saveNote(note: CreditNote) {
  const valid = noteSchema.parse(note);
  const notes = readNotes(valid.pool), previous = notes.find(n => n.commitment === valid.commitment);
  const merged = { ...valid, nextI: Math.max(valid.nextI, previous?.nextI ?? 0), leafIndex: valid.leafIndex ?? previous?.leafIndex ?? null, depositTx: valid.depositTx ?? previous?.depositTx };
  localStorage.setItem(key(valid.pool), JSON.stringify([...notes.filter(n => n.commitment !== valid.commitment), merged]));
  return merged;
}
export function reserveCredit(note: CreditNote) {
  const current = readNotes(note.pool).find(n => n.commitment === note.commitment);
  if (!current || current.nextI !== note.nextI || current.nextI >= 200) throw new Error('This credit note changed. Refresh your credits before asking.');
  return saveNote({ ...current, nextI: current.nextI + 1 });
}
async function backupKey(password: string, salt: Uint8Array) {
  if (password.length < 12) throw new Error('Use a backup password of at least 12 characters.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 310_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function exportNotes(notes: CreditNote[], password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await backupKey(password, salt), new TextEncoder().encode(JSON.stringify(notes)));
  return JSON.stringify({ format: 'fluxo-backup-v1', salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(encrypted)) });
}
export async function importNotes(text: string, password: string, pool: string) {
  if (text.length > 1_000_000) throw new Error('The backup file is too large.');
  const data = z.object({ format: z.literal('fluxo-backup-v1'), salt: z.string(), iv: z.string(), ciphertext: z.string() }).parse(JSON.parse(text));
  const salt = fromBase64(data.salt), iv = fromBase64(data.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid backup.');
  let plain: ArrayBuffer;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await backupKey(password, salt), fromBase64(data.ciphertext)); }
  catch { throw new Error('Could not open the backup. Check the password and file.'); }
  const notes = z.array(noteSchema).max(1024).parse(JSON.parse(new TextDecoder().decode(plain)));
  if (notes.some(n => n.pool !== pool)) throw new Error('This backup belongs to a different credit pool.');
  for (const note of notes) saveNote(note);
  return readNotes(pool);
}
