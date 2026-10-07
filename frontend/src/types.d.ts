declare module 'snarkjs' {
  export const groth16: {
    fullProve(input: Record<string, unknown>, wasm: Uint8Array | string, zkey: Uint8Array | string, logger?: unknown, witnessOptions?: unknown, proverOptions?: { singleThread: boolean }): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(key: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
