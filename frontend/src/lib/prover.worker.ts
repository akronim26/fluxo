import { groth16 } from 'snarkjs';
self.onmessage = async (event: MessageEvent<{ input: Record<string, unknown>; wasm: Uint8Array; zkey: Uint8Array }>) => {
  try { const { input, wasm, zkey } = event.data; const result = await groth16.fullProve(input, wasm, zkey, undefined, undefined, { singleThread: true }); self.postMessage({ result }); }
  catch { self.postMessage({ error: 'The browser could not generate a credit proof. Your credit was not submitted.' }); }
};
