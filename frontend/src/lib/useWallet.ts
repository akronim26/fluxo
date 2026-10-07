import { useEffect, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { StandardConnectFeature, StandardDisconnectFeature, StandardEventsFeature } from '@wallet-standard/features';
import type { SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
type SupportedWallet = Wallet & { features: StandardConnectFeature & StandardEventsFeature & SolanaSignTransactionFeature & Partial<StandardDisconnectFeature> };
function supported(wallet: Wallet): wallet is SupportedWallet { return wallet.chains.includes('solana:devnet') && ['standard:connect','standard:events','solana:signTransaction'].every(key => key in wallet.features); }
export function useWallet() {
  const [wallets, setWallets] = useState<SupportedWallet[]>([]), [wallet, setWallet] = useState<SupportedWallet>(), [account, setAccount] = useState<WalletAccount>();
  useEffect(() => { const registry = getWallets(); const update = () => setWallets(registry.get().filter(supported)); update(); const off = [registry.on('register',update), registry.on('unregister',update)]; return () => off.forEach(fn => fn()); }, []);
  useEffect(() => wallet?.features['standard:events'].on('change', ({ accounts }) => { if (accounts) { const next = accounts.find(a => a.chains.includes('solana:devnet')); setAccount(next); if (!next) setWallet(undefined); } }), [wallet]);
  async function connect(selected: SupportedWallet) { const result = await selected.features['standard:connect'].connect(); const next = result.accounts.find(a => a.chains.includes('solana:devnet') && a.features.includes('solana:signTransaction')); if (!next) throw new Error('Switch your wallet to a Solana devnet account.'); setWallet(selected); setAccount(next); }
  async function disconnect() { await wallet?.features['standard:disconnect']?.disconnect(); setWallet(undefined); setAccount(undefined); }
  return { wallets, wallet, account, connect, disconnect };
}
