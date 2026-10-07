// Live end-to-end test of the real app: a real Chromium drives the running dev server
// (http://127.0.0.1:5173) against the real gateway, Solana devnet, the in-browser
// prover and local Ollama. Nothing is mocked except the wallet: a minimal Wallet
// Standard wallet is registered in the page and signs with a throwaway devnet test
// key that stays in this Node process (the page never sees it).
//
// Usage (from frontend/, with the gateway and `npm run dev` running):
//   LIVE_WALLET=/path/to/test-keypair.json SHOTS=/tmp/dir npx tsx tests/live/live-e2e.ts
import { chromium, type Page } from '@playwright/test';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173/#app';
const SHOTS = process.env.SHOTS ?? 'test-results/live';
const keyPath = process.env.LIVE_WALLET;
if (!keyPath) throw new Error('set LIVE_WALLET to a devnet test keypair file');
const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, 'utf8'))));
mkdirSync(SHOTS, { recursive: true });

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
let shot = 0;
const snap = async (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${String(++shot).padStart(2, '0')}-${name}.png`), fullPage: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const pageErrors: string[] = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });

// Node-side signer: the page passes transaction bytes, gets signed bytes back.
let signatures = 0;
await page.exposeFunction('__liveWalletSign', (bytes: number[]) => {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
  tx.sign([key]);
  signatures++;
  return Array.from(tx.serialize());
});

// Minimal Wallet Standard wallet (standard:connect/events/disconnect + solana:signTransaction on devnet).
// Passed as source text: tsx's transform would inject helpers (__name) into a function.
await page.addInitScript(`(() => {
  const address = ${JSON.stringify(key.publicKey.toBase58())};
  const publicKey = Uint8Array.from(${JSON.stringify(Array.from(key.publicKey.toBytes()))});
  const listeners = new Set();
  const account = { address, publicKey, chains: ['solana:devnet'], features: ['solana:signTransaction'], label: 'Live test wallet' };
  const wallet = {
    version: '1.0.0',
    name: 'Live Test Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScxJyBoZWlnaHQ9JzEnLz4=',
    chains: ['solana:devnet'],
    accounts: [],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => { wallet.accounts = [account]; listeners.forEach((l) => l({ accounts: wallet.accounts })); return { accounts: wallet.accounts }; } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { wallet.accounts = []; listeners.forEach((l) => l({ accounts: [] })); } },
      'standard:events': { version: '1.0.0', on: (_e, l) => { listeners.add(l); return () => listeners.delete(l); } },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs) => Promise.all(inputs.map(async (i) => ({ signedTransaction: Uint8Array.from(await window.__liveWalletSign(Array.from(i.transaction))) }))),
      },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener('wallet-standard:app-ready', (e) => register(e.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
})();`);

const status = (p: Page) => p.locator('[role=status]').allInnerTexts();
const errorText = (p: Page) => p.locator('[role=alert]').allInnerTexts();
const credits = async () => Number((await page.locator('.funding-panel').innerText()).match(/\n(\d+)\navailable credits/)?.[1] ?? NaN);
async function waitFor(desc: string, fn: () => Promise<boolean>, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await fn()) return; const errs = await errorText(page); if (errs.length) throw new Error(`${desc}: ${errs.join(' | ')}`); await page.waitForTimeout(1000); }
  throw new Error(`${desc}: timed out after ${timeoutMs / 1000}s (status: ${(await status(page)).join(' | ')})`);
}

let failed = false;
try {
  log(`wallet ${key.publicKey.toBase58()}`);
  await page.goto(APP);
  await page.getByText('Gateway connected').waitFor({ timeout: 30_000 });
  log('app loaded, gateway connected');
  await snap(page, 'workspace');

  // 1. Connect the wallet through the app's own picker.
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: /Live Test Wallet/ }).click();
  await page.getByText(/…/).filter({ hasText: key.publicKey.toBase58().slice(0, 5) }).first().waitFor({ timeout: 10_000 });
  log('wallet connected');

  // 2. Faucet (gateway mints tUSDC + sends devnet SOL). One attempt per wallet per hour:
  // SKIP_FAUCET=1 reuses a wallet that was already funded.
  if (!process.env.SKIP_FAUCET) {
  await page.getByRole('button', { name: /Get free test tokens/ }).click();
  await waitFor('faucet', async () => (await status(page)).some((s) => /token|SOL|sent|received|ready/i.test(s)) && !(await status(page)).some((s) => /Requesting/.test(s)), 240_000);
  log(`faucet: ${(await status(page)).join(' | ')}`);
  await snap(page, 'faucet');
  }

  // 3. Deposit 10 tUSDC (wallet signs; note stored in the browser; 200 credits).
  const before = await credits();
  await page.getByRole('button', { name: /Deposit 10 tUSDC/ }).click();
  await waitFor('deposit', async () => (await status(page)).some((s) => /Deposit confirmed/.test(s)), 240_000);
  const backup = page.getByRole('dialog');
  if (await backup.isVisible().catch(() => false)) { await page.keyboard.press('Escape'); }
  const depositTx = await page.getByRole('link', { name: 'View transaction' }).getAttribute('href');
  log(`deposit confirmed: credits ${before} -> ${await credits()} | ${depositTx}`);
  await snap(page, 'deposit');

  // 4. Question with profile details → local Ollama rewrite + rules → privacy diff.
  await page.getByRole('button', { name: /Try a sample/ }).click();
  const localModel = page.getByRole('checkbox', { name: /Rewrite with local Ollama/ });
  if (!(await localModel.isChecked())) await localModel.check();
  await page.getByRole('button', { name: 'Preview privacy' }).click();
  await page.getByText('A little less personal.').waitFor({ timeout: 180_000 });
  const mode = await page.locator('.mode-badge').innerText();
  const [typed, outgoing] = await page.locator('.diff-grid > div').allInnerTexts();
  log(`privacy diff (${mode})\n  typed:    ${typed.replace(/\s+/g, ' ').slice(0, 200)}\n  outgoing: ${outgoing.replace(/\s+/g, ' ').slice(0, 200)}`);
  await snap(page, 'privacy-diff');

  // 5. Approve and ask (in-browser proof → gateway → stage → CRE TEE answer + spend → mailbox).
  await page.getByRole('checkbox', { name: /I have reviewed the outgoing text/ }).check();
  await page.getByRole('button', { name: 'Ask privately', exact: true }).click();
  await page.getByText('Your answer.').waitFor({ timeout: 300_000 });
  const answer = await page.locator('.answer-panel').innerText();
  const spendTx = await page.getByRole('link', { name: 'View verified credit spend' }).getAttribute('href').catch(() => null);
  log(`answer received (${answer.length} chars), personalised: ${/Applied locally to your profile/.test(answer)}, plain text: ${/plain text/.test(answer)}`);
  log(`  ${answer.replace(/\s+/g, ' ').slice(0, 300)}`);
  log(`spend tx: ${spendTx}`);
  log(`credits now ${await credits()}`);
  await snap(page, 'answer');
} catch (e) {
  failed = true;
  log(`FAILED: ${(e as Error).message}`);
  await snap(page, 'failure').catch(() => {});
} finally {
  log(`wallet signatures: ${signatures}; page errors: ${pageErrors.length ? pageErrors.join(' || ') : 'none'}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
