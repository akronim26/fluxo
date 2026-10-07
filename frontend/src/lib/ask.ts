import { poseidon2 } from 'poseidon-lite/poseidon2';
import { api, ApiError, assetUrl, type PublicConfig } from './api';
import { hex, openAnswer, sealQuestion, sha256 } from './crypto';
import { readNotes, reserveCredit, type CreditNote } from './notes';
import { getLeaves, merklePath } from './solana';
async function verifiedAsset(url: string, expected: string | undefined) {
  if (!expected) throw new Error('Missing proving-asset checksum.');
  const response = await fetch(assetUrl(url), { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('The proving files could not be downloaded from the gateway.');
  const data = new Uint8Array(await response.arrayBuffer());
  if (hex(await sha256(data)) !== expected) throw new Error('A proving file failed its integrity check.');
  return data;
}
export async function prove(input: Record<string, unknown>, config: PublicConfig) {
  const [wasm, zkey] = await Promise.all([verifiedAsset(config.circuit.wasmUrl, config.circuit.sha256['credit.wasm']), verifiedAsset(config.circuit.zkeyUrl, config.circuit.sha256['credit_final.zkey'])]);
  return new Promise<{ proof: unknown; publicSignals: string[] }>((resolve,reject) => {
    const worker = new Worker(new URL('./prover.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Proving took too long. No credit was submitted.')); }, 120_000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = ({ data }) => { finish(); data.error ? reject(new Error(data.error)) : resolve(data.result); };
    worker.onerror = () => { finish(); reject(new Error('The proof worker could not start. Try a current browser.')); };
    worker.postMessage({ input, wasm, zkey }, [wasm.buffer, zkey.buffer]);
  });
}
export async function askPrivately(config: PublicConfig, selected: CreditNote, question: string, status: (message: string) => void, onReserved: () => void) {
  if (!config.ready.spend) throw new Error('Private requests are not configured yet.');
  if (!navigator.locks) throw new Error('This browser cannot safely reserve a credit. Use a current browser on HTTPS or localhost.');
  return navigator.locks.request(`brizo:spend:${selected.pool}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Another tab is using your credits. Wait for that request to finish.');
    const note = readNotes(selected.pool).find(n => n.commitment === selected.commitment);
    if (!note || note.nextI >= 200 || note.leafIndex === null) throw new Error('Add or refresh your credits first.');
    status('Encrypting your reviewed question on this device…');
    const sealed = await sealQuestion(question, config.enclaveBoxPublicKey);
    try {
      const leaves = await getLeaves(config);
      if (leaves[note.leafIndex]?.toString() !== note.commitment) throw new Error('The deposit note does not match the pool.');
      const path = merklePath(leaves, note.leafIndex);
      const nullifierHash = poseidon2([BigInt(note.nk), BigInt(note.nextI)]).toString();
      status('Creating a zero-knowledge proof in your browser…');
      const proof = await prove({ ...path, secret: note.secret, nk: note.nk, i: note.nextI, nullifierHash, requestBinding: sealed.binding }, config);
      if (proof.publicSignals.join(',') !== [path.root, nullifierHash, sealed.binding].join(',')) throw new Error('The proof outputs did not match this request.');
      reserveCredit(note); onReserved(); // Never reuse a credit after an uncertain broadcast.
      status('Verifying your credit and waiting for the confidential workflow…');
      const { secretKey: _secret, binding: _binding, ...envelope } = sealed;
      let spendTx: string | undefined;
      try { const result = await api<{ spendTx: string }>('/api/ask', { method: 'POST', body: JSON.stringify({ ...envelope, ...proof }), signal: AbortSignal.timeout(270_000) }); spendTx = result.spendTx; }
      catch (error) { if (error instanceof ApiError) throw error; status('Connection interrupted. Checking the existing request; no new credit will be spent…'); }
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const result = await api<{ requestId: string; ciphertext?: string; nonce?: string; spendTx?: string }>(`/api/answer/${sealed.requestId}`);
        if (result.requestId !== sealed.requestId) throw new Error('The gateway returned a different request.');
        if (result.ciphertext && result.nonce) return { text: await openAnswer({ ciphertext: result.ciphertext, nonce: result.nonce }, sealed, config.enclaveBoxPublicKey), spendTx: result.spendTx || spendTx };
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      throw new Error(`Request ${sealed.requestId} is still pending. Keep this tab open and contact the gateway operator. The credit has been reserved and will not be retried.`);
    } finally { sealed.secretKey.fill(0); }
  });
}
