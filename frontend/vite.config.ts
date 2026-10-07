import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.GATEWAY_PROXY_TARGET || 'http://127.0.0.1:8788';
  return {
    plugins: [react()],
    resolve: { alias: { buffer: 'buffer/' } },
    optimizeDeps: { include: ['snarkjs', 'poseidon-lite/poseidon2', '@solana/web3.js', 'bs58'] },
    server: { port: 5173, strictPort: true, proxy: {
      '/api': { target, changeOrigin: true, timeout: 300_000, proxyTimeout: 300_000 },
      '/circuits': { target, changeOrigin: true },
    } },
    // `vite preview` serves the production build on one origin for hosting through a
    // tunnel: /api and /circuits go to the gateway, so the app needs no gateway URL.
    preview: { port: 4173, strictPort: true, allowedHosts: ['.trycloudflare.com'], proxy: {
      '/api': { target, changeOrigin: true, timeout: 300_000, proxyTimeout: 300_000 },
      '/circuits': { target, changeOrigin: true },
    } },
    build: { target: 'es2022' },
  };
});
