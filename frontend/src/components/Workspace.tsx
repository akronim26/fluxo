import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { getConfig, type PublicConfig } from '../lib/api';
import { readNotes, type CreditNote } from '../lib/notes';
import { FundingPanel } from './FundingPanel';
import { QuestionPanel } from './QuestionPanel';
import { Logo, REPO } from './Primitives';
import '../workspace.css';

export default function Workspace() {
  const [config, setConfig] = useState<PublicConfig>(), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notes, setNotes] = useState<CreditNote[]>([]), [locked, setLocked] = useState(false);
  const reload = useCallback(() => { if (config?.pool) { try { setNotes(readNotes(config.pool)); } catch { setError('The saved credit notes could not be read. Export your browser data before making changes.'); } } }, [config]);
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { setConfig(await getConfig()); } catch (e) { setConfig(undefined); setError(e instanceof Error ? e.message : 'The gateway could not be reached.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { reload(); window.addEventListener('storage', reload); return () => window.removeEventListener('storage',reload); }, [reload]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (locked) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn); }, [locked]);
  return <div className="workspace"><header className="workspace-header"><Logo /><div><span className="devnet-pill">SOLANA DEVNET</span><a href="#" className="back-link"><ArrowLeft size={14} />Back to home</a></div></header><main className="workspace-main" id="workspace-main" tabIndex={-1}><div className="workspace-title"><div><div className="eyebrow"><span />Your private workspace</div><h1>A question worth keeping<br /><span>to yourself.</span></h1></div><div className="workspace-stamp"><ShieldCheck size={22} strokeWidth={1.3} /><span>YOUR DEVICE.<br />YOUR DECISION.</span></div></div>
    <div className={`gateway-status ${error ? 'gateway-offline' : ''}`} role="status"><span className={`status-dot ${!config?.ready.spend ? 'status-muted' : ''}`} /><span>{loading ? 'Connecting to the gateway…' : error ? 'Gateway unavailable — you can still try the local privacy preview.' : config?.ready.spend ? 'Gateway connected · private requests ready' : 'Gateway connected · private requests awaiting configuration'}</span><button aria-label="Refresh gateway connection" disabled={loading || locked} onClick={() => void refresh()}><RefreshCw size={14} /></button></div>
    {error && <details className="connection-details"><summary>Connection details</summary><p>{error}</p></details>}
    <div className="workspace-layout"><QuestionPanel config={config} notes={notes} reload={reload} locked={locked} setLocked={setLocked} /><FundingPanel config={config} notes={notes} reload={reload} locked={locked} setLocked={setLocked} /></div>
    <footer className="workspace-footer"><p><ShieldCheck size={14} />Demo on devnet. Scrubbing is best-effort; the gateway sees IPs and timing. CRE runs in simulation.</p><a href={`${REPO}/blob/main/docs/ARCHITECTURE.md`} target="_blank" rel="noreferrer">Privacy & limitations <ArrowUpRight size={12} /></a></footer></main></div>;
}
