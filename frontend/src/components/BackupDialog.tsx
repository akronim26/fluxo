import { useEffect, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { exportNotes, importNotes, type CreditNote } from '../lib/notes';

export function BackupDialog({ notes, pool, onClose, onRestored }: { notes: CreditNote[]; pool: string; onClose: () => void; onRestored: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), file = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setSuccess(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not process this backup.'); } finally { setBusy(false); } }
  return <dialog ref={ref} className="backup-dialog" aria-labelledby="backup-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }} onClose={onClose}>
    <div className="panel-heading"><h2 id="backup-title">Your credits. Backed up.</h2><button className="icon-button" aria-label="Close backup" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    <p>Your credit notes unlock your credits. This backup is encrypted on your device. Keep the file and its password somewhere safe.</p>
    <label className="field-label" htmlFor="backup-password">Backup password</label><input id="backup-password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} placeholder="At least 12 characters" />
    <div className="backup-actions"><button className="button button-dark" disabled={busy || password.length < 12 || !notes.length} onClick={() => run(async () => {
      const data = await exportNotes(notes, password), url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'fluxo-encrypted-credits.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setSuccess('Encrypted backup downloaded.');
    })}><Download size={16} />Export notes</button><button className="button button-light" disabled={busy || password.length < 12} onClick={() => file.current?.click()}><Upload size={16} />Restore backup</button></div>
    <input ref={file} className="sr-only" aria-label="Encrypted credit backup" type="file" accept=".json,application/json" disabled={busy} onChange={e => { const selected = e.target.files?.[0]; if (selected) void run(async () => { if (selected.size > 1_000_000) throw new Error('The backup file is too large.'); await importNotes(await selected.text(), password, pool); onRestored(); setSuccess('Backup restored. Refresh your credits to check the deposit on-chain.'); }); e.target.value = ''; }} />
    <p className="helper-text">Old backups may contain already-spent credits. Solana rejects reuse. Restoring does not reset credits already reserved in this browser.</p>
    {busy && <p role="status">Working on your device…</p>}{error && <p className="error-message" role="alert">{error}</p>}{success && <p className="success-message" role="status">{success}</p>}
  </dialog>;
}
