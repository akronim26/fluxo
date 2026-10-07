import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, RefreshCw, Wallet, X } from 'lucide-react';
import { api, explorer, type PublicConfig } from '../lib/api';
import { newNote, readNotes, saveNote, type CreditNote } from '../lib/notes';
import { deposit, getLeaves } from '../lib/solana';
import { useWallet } from '../lib/useWallet';
import { BackupDialog } from './BackupDialog';
import { ExternalLink } from './Primitives';

export function FundingPanel({ config, notes, reload, locked, setLocked }: { config?: PublicConfig; notes: CreditNote[]; reload: () => void; locked: boolean; setLocked: (value: boolean) => void }) {
  const running = useRef(false);
  const wallet = useWallet(), picker = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState(''), [backup, setBackup] = useState(false), [tx, setTx] = useState('');
  const unavailable = busy || locked;
  const credits = notes.filter(n => n.leafIndex !== null).reduce((sum,n) => sum + 200 - n.nextI, 0);
  async function run(action: () => Promise<void>) { if (unavailable || running.current) return; running.current = true; setBusy(true); setLocked(true); setError(''); setStatus(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'This action could not be completed.'); } finally { running.current = false; setBusy(false); setLocked(false); reload(); } }
  useEffect(() => { if (wallet.account) picker.current?.close(); }, [wallet.account]);
  async function refresh() {
    if (!config?.pool) return;
    const leaves = await getLeaves(config);
    for (const note of readNotes(config.pool)) { const index = leaves.findIndex(v => v.toString() === note.commitment); if (index >= 0) saveNote({ ...note, leafIndex: index }); }
    setStatus('Deposit notes checked against the on-chain pool.');
  }
  async function fund() {
    if (!wallet.account) return;
    setStatus('Requesting free test tokens…');
    const result = await api<{ tokenTx: string; solTx: string }>('/api/faucet', { method: 'POST', body: JSON.stringify({ owner: wallet.account.address }), signal: AbortSignal.timeout(200_000) });
    setTx(result.tokenTx); setStatus('20 tUSDC and 0.02 devnet SOL sent to your wallet.');
  }
  async function addCredits() {
    if (!config?.pool || !wallet.account || !wallet.wallet) return;
    await refresh();
    const current = readNotes(config.pool);
    const pending = current.find(n => n.leafIndex === null);
    if (pending?.depositTx) throw new Error('An earlier deposit is still unconfirmed. Check its transaction and refresh before depositing again.');
    const note = pending ?? newNote(config.pool);
    const result = await deposit(config, note, wallet.account, wallet.wallet.features['solana:signTransaction'], setStatus);
    if (result.depositTx) setTx(result.depositTx);
    setStatus('Deposit confirmed. Your 200 credits are ready. Back up your note.');
  }
  return <aside className="funding-panel" aria-labelledby="credit-title"><div className="panel-heading"><span className="mono">YOUR PRIVATE CREDITS</span><Wallet size={18} strokeWidth={1.5} /></div><h2 id="credit-title" className="credit-balance">{credits}<span>available credits</span></h2><p className="helper-text">1 credit = 1 private question.<br />10 tUSDC adds 200 credits.</p><div className="funding-divider" />
    {wallet.account ? <div className="connected-wallet"><span className="status-dot" /><span>{wallet.account.address.slice(0,5)}…{wallet.account.address.slice(-5)}</span><button disabled={unavailable} onClick={() => run(wallet.disconnect)}>Disconnect</button></div> : <button className="button button-dark full-width" disabled={unavailable} onClick={() => { setError(''); picker.current?.showModal(); }}><Wallet size={16} />Connect wallet</button>}
    <button className="button button-light full-width" disabled={unavailable || !wallet.account || !config?.ready.faucet} onClick={() => run(fund)}>Get free test tokens<ArrowUpRight size={15} /></button>
    {!config?.ready.faucet && <p className="helper-text">{config ? 'The faucet is not configured on this gateway.' : 'Connect the gateway to access the faucet.'}</p>}
    <button className="button button-dark full-width" disabled={unavailable || !wallet.account || !config?.pool} onClick={() => run(addCredits)}>Deposit 10 tUSDC<ArrowUpRight size={15} /></button>
    <p className="helper-text">Solana devnet only. Your wallet pays the network fee and asks you to approve the deposit to the Fluxo pool.</p>
    {notes.some(n => n.leafIndex === null) && <p className="inline-notice">A deposit note is waiting for confirmation. Refresh credits to recover it.</p>}
    <div className="note-actions"><button disabled={unavailable || !config?.pool} onClick={() => run(refresh)}><RefreshCw size={13} />Refresh credits</button><button disabled={unavailable || !config?.pool} onClick={() => setBackup(true)}><Download size={13} />Backup / restore</button></div>
    {busy && <div className="progress-line" aria-hidden="true" />}{status && <p className="status-message" role="status">{status}</p>}{error && <p className="error-message" role="alert">{error}</p>}{tx && <ExternalLink href={explorer(tx)}>View transaction</ExternalLink>}
    <div className="local-note"><LockIcon /><p>Credit notes stay in this browser. Export a backup before clearing site data.</p></div>
    <dialog ref={picker} className="wallet-dialog" aria-labelledby="wallet-title"><div className="panel-heading"><h2 id="wallet-title">Connect your wallet</h2><button className="icon-button" aria-label="Close wallet picker" onClick={() => picker.current?.close()}><X size={20} /></button></div><p>Choose a Solana wallet. Fluxo uses devnet test tokens.</p>{wallet.wallets.length ? <div className="wallet-options">{wallet.wallets.map(w => <button key={w.name} disabled={unavailable} onClick={() => run(() => wallet.connect(w))}><img src={w.icon} alt="" width="28" height="28" />{w.name}<ArrowUpRight size={16} /></button>)}</div> : <div className="wallet-empty"><Wallet size={32} strokeWidth={1} /><h3>No Solana wallet detected</h3><p>Open Fluxo in a browser with a Wallet Standard compatible Solana wallet, such as Phantom or Solflare. You can explore the privacy preview without one.</p><ExternalLink href="https://phantom.com/download">Get Phantom</ExternalLink></div>}{error && <p className="error-message" role="alert">{error}</p>}</dialog>
    {backup && config?.pool && <BackupDialog notes={notes} pool={config.pool} onClose={() => setBackup(false)} onRestored={reload} />}
  </aside>;
}
function LockIcon() { return <svg width="16" height="18" viewBox="0 0 16 18" fill="none" aria-hidden="true"><rect x="2" y="7" width="12" height="9" rx="2" stroke="currentColor"/><path d="M5 7V4a3 3 0 016 0v3" stroke="currentColor"/></svg>; }
