import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { poseidon2 } from 'poseidon-lite';
import { base64, fromBase64, fromHex, hex, openAnswer, requestBinding, sealQuestion, sha256 } from '../src/lib/crypto';
import { emptyProfile, personaliseAnswer, scrub } from '../src/lib/privacy';
import { exportNotes, importNotes, newNote, readNotes, reserveCredit, saveNote } from '../src/lib/notes';
import { decodeLeaves, merklePath } from '../src/lib/solana';
import { configSchema } from '../src/lib/api';
const fixture = JSON.parse(readFileSync(new URL('../../circuits/build/poseidon-vectors.json', import.meta.url), 'utf8'));
const pool = '11111111111111111111111111111111';
beforeEach(() => { const store = new Map<string,string>(); vi.stubGlobal('localStorage', { getItem: (k:string) => store.get(k) ?? null, setItem: (k:string,v:string) => store.set(k,v) }); });

describe('privacy boundary', () => {
  it('removes known names, cities, contacts and private terms, while flagging unknown identifiers', () => {
    const review = scrub('Alex Smith, age 34, in Singapore at Acme. Email alex@example.com. Ask Dr Wilson about 29.', { name: 'Alex Smith', age: '34', city: 'Singapore', privateTerms: 'Acme' });
    for (const value of ['Alex','Smith','34','Singapore','Acme','alex@example.com']) expect(review.text).not.toContain(value);
    expect(review.text).not.toContain('example.com'); expect(review.text).toContain('[email removed]');
    expect(review.text).toContain('in their 30s'); expect(review.text).not.toContain('Wilson'); expect(review.flagged).toContain('29');
  });
  it('generalises names and ages typed into the question even with an empty profile (rules-only)', () => {
    const review = scrub('My client is Soham Vijay, 23. He just assaulted a girl aged 13. I am 34 and live in Singapore, working at Meridian Labs. How should I defend him in court?', emptyProfile);
    for (const value of ['Soham', 'Vijay', '23', '13', '34', 'Singapore', 'Meridian']) expect(review.text).not.toContain(value);
    expect(review.text).toContain('in their 20s'); expect(review.text).toContain('in their teens'); expect(review.text).toContain('a city');
    expect(review.text).toContain('How should I defend him in court?');
  });
  it('handles regex characters and removes every occurrence', () => {
    expect(scrub('A+B uses A+B in [HQ].', { ...emptyProfile, name:'A+B', city:'[HQ]' }).text).toBe('[private detail] uses [private detail] in a city.');
  });
  it('only applies typed, known answer branches, never executes model text', () => {
    const result = personaliseAnswer(JSON.stringify({ general:'General', branches:[{ when:{field:'age',op:'gt',value:30},advice:'Matches' },{when:{field:'age',op:'lt',value:30},advice:'No'},{when:{field:'constructor',op:'eq',value:'anything'},advice:'No'}], caveats:'Caveat' }),{...emptyProfile,age:'34'});
    expect(result.advice).toEqual(['Matches']); expect(personaliseAnswer('<script>alert(1)</script>',emptyProfile).formatted).toBe(false);
  });
});
describe('wire protocol', () => {
  it('matches the cross-lane decoded-byte binding vector', async () => {
    expect(await requestBinding('000102030405060708090a0b0c0d0e0f','aGVsbG8=')).toBe('12591868490619502940983479717201964167859440711926496621633181383191911195486');
  });
  it('encrypts only the reviewed question and authenticates the answer nonce', async () => {
    const enclave = nacl.box.keyPair(), publicKey = base64(enclave.publicKey);
    const sealed = await sealQuestion('A generic question',publicKey);
    const opened = nacl.box.open(fromBase64(sealed.ciphertext),fromBase64(sealed.nonce),fromBase64(sealed.clientPub),enclave.secretKey)!;
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual({ question:'A generic question',bands:{} });
    const nonce = (await sha256(new Uint8Array([...fromHex(sealed.requestId),...fromBase64(sealed.clientPub),...new TextEncoder().encode('answer')]))).slice(0,24);
    const ciphertext = base64(nacl.box(new TextEncoder().encode(JSON.stringify({ok:true,answer:'Private answer'})),nonce,fromBase64(sealed.clientPub),enclave.secretKey));
    expect(await openAnswer({ciphertext,nonce:base64(nonce)},sealed,publicKey)).toBe('Private answer');
    await expect(openAnswer({ciphertext,nonce:base64(new Uint8Array(24))},sealed,publicKey)).rejects.toThrow('nonce');
  });
  it('rejects mainnet config', () => { expect(configSchema.safeParse({ cluster:'mainnet-beta' }).success).toBe(false); });
});
describe('credit safety', () => {
  it('matches the circuit Poseidon vector and reconstructs its one-leaf root', () => {
    const commitment = poseidon2([123n,456n]); expect(commitment.toString()).toBe(fixture.commitment);
    const path = merklePath([commitment],0); expect(path.pathIndices).toEqual(Array(10).fill(0));
    expect(path.root).toBe(fixture.oneLeafRoot ?? fixture.root);
  });
  it('rejects malformed on-chain leaf accounts', () => { expect(() => decodeLeaves(new Uint8Array(100))).toThrow(); const bad = new Uint8Array(32784); expect(() => decodeLeaves(bad)).toThrow(); });
  it('reserves before submission and rejects stale reservations', () => {
    const note = saveNote({...newNote(pool),leafIndex:0}); reserveCredit(note);
    expect(readNotes(pool)[0].nextI).toBe(1); expect(() => reserveCredit(note)).toThrow('changed');
  });
  it('encrypted backups round trip without rolling back credits, and reject wrong passwords/pools', async () => {
    const note = saveNote({...newNote(pool),leafIndex:0}); const backup = await exportNotes([note],'correct horse battery');
    expect(backup).not.toContain(note.secret); reserveCredit(note);
    expect((await importNotes(backup,'correct horse battery',pool))[0].nextI).toBe(1);
    await expect(importNotes(backup,'incorrect password',pool)).rejects.toThrow('password');
    await expect(importNotes(backup,'correct horse battery','different-pool')).rejects.toThrow('different');
  });
});
