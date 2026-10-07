import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Landing } from './components/Landing';
const Workspace = lazy(() => import('./components/Workspace'));

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="error-page"><h1>Something didn’t load.</h1><p>Your saved credit notes are still in this browser. Reload to try again.</p><button className="button button-dark" onClick={() => location.reload()}>Reload Fluxo</button></main> : this.props.children; }
}
export function App() {
  const [workspace, setWorkspace] = useState(['#app', '#workspace-main'].includes(location.hash));
  const [opened, setOpened] = useState(['#app', '#workspace-main'].includes(location.hash));
  useEffect(() => {
    const route = () => { const active = ['#app', '#workspace-main'].includes(location.hash); setWorkspace(active); if (active) { setOpened(true); window.scrollTo(0, 0); } };
    window.addEventListener('hashchange', route); return () => window.removeEventListener('hashchange', route);
  }, []);
  useEffect(() => { document.title = workspace ? 'Workspace — Fluxo' : 'Fluxo — A private way to ask'; }, [workspace]);
  return <ErrorBoundary><a className="skip-link" href={workspace ? '#workspace-main' : '#main-content'}>Skip to content</a><div hidden={workspace}><Landing /></div>{opened && <div hidden={!workspace}><Suspense fallback={<div className="workspace-loading" role="status">Opening your workspace…</div>}><Workspace /></Suspense></div>}</ErrorBoundary>;
}
