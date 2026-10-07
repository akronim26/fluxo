import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronRight, Code2, Copy, Fingerprint, LockKeyhole, Menu, Minus, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { AsciiGlobe } from './AsciiGlobe';
import { ExternalLink, Eyebrow, LaunchLink, Logo, REPO } from './Primitives';

const features = [
  { title: 'Your details stay personal.', text: 'Review a locally scrubbed version of your question before anything is sent. Names, contact details, and known personal values are removed on your device.', icon: Fingerprint, label: 'LOCAL PRIVACY' },
  { title: 'Credits without a paper trail.', text: 'One deposit. Two hundred questions. A zero-knowledge proof spends a credit without revealing which deposit it came from.', icon: Sparkles, label: 'ZERO-KNOWLEDGE CREDITS' },
  { title: 'A confidential path to AI.', text: 'Your reviewed question is encrypted to the workflow’s key. The model call runs inside a Chainlink CRE confidential workflow, and the answer is sealed back to you.', icon: LockKeyhole, label: 'ENCRYPTED REQUESTS' },
  { title: 'Trust you can inspect.', text: 'Solana verifies credit proofs and rejects double spending. The code, contracts, and devnet transaction history are open for you to explore.', icon: ShieldCheck, label: 'VERIFIABLE ON SOLANA' },
];
const steps = [
  { title: 'Connect. Get your credits.', text: 'Connect a Solana wallet, get free test tokens, and deposit 10 tUSDC for 200 credits.', code: ['// 01 · Fund your private credits', 'connect("solana:devnet")', 'deposit({ amount: 10, token: "tUSDC" })', '', '// Your credit note stays on this device.', 'credits.available → 200'] },
  { title: 'Ask. Review what you share.', text: 'Write your question, add the details to keep private, and inspect exactly what will leave your device.', code: ['// 02 · Review before sending', 'question → local privacy check', 'personal details → removed', '', '// Only your approved version is encrypted.', 'review → encrypt → prove'] },
  { title: 'An answer. Just for you.', text: 'A confidential workflow calls the model. Your browser decrypts the answer and applies relevant advice locally.', code: ['// 03 · A sealed answer comes home', 'verify(credit.proof)', 'run(confidentialWorkflow)', '', '// Decrypted in your browser.', 'answer → open → personalise'] },
];
const faqs = [
  ['Is this using real money?', 'No. This demo runs on Solana devnet with tUSDC test tokens. The faucet provides tokens for testing. They have no monetary value.'],
  ['What does the model provider see?', 'The provider and OpenRouter see the reviewed question from the workflow’s account. They do not receive your wallet or credit note. Scrubbing is best-effort, so always review the outgoing text.'],
  ['Is Brizo completely anonymous?', 'No. The gateway sees your IP address and timing. A small pool of depositors weakens payment privacy. Rules-only scrubbing does not hide your writing style, and the team that provisioned the enclave key could decrypt intercepted scrubbed requests.'],
  ['Where are my credits stored?', 'Your private credit note is saved in this browser. Export an encrypted backup from the workspace before clearing browser data. An old backup can include credits already spent; the chain still rejects reuse.'],
  ['Is this a production service?', 'This is a hackathon demo. CRE runs through the simulator, while transactions are real devnet transactions. The cryptography has not been independently audited and uses a single-party phase 2 setup.'],
];

function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 60);
    const close = () => setMenu(false);
    update(); window.addEventListener('scroll', update, { passive: true }); window.addEventListener('hashchange', close);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('hashchange', close); };
  }, []);
  return <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
    <nav className="nav-shell" aria-label="Main navigation">
      <Logo />
      <div className="desktop-links"><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#developers">Developers</a><a href="#pricing">Pricing</a></div>
      <div className="nav-actions"><a href="#privacy">Privacy first</a><a href="#app" className="nav-cta">Launch app <ArrowUpRight size={14} /></a></div>
      <button className="menu-toggle icon-button" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} aria-controls="mobile-menu" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>
    </nav>
    {menu && <div className="mobile-menu" id="mobile-menu"><a href="#features" onClick={() => setMenu(false)}>Features</a><a href="#how-it-works" onClick={() => setMenu(false)}>How it works</a><a href="#developers" onClick={() => setMenu(false)}>Developers</a><a href="#pricing" onClick={() => setMenu(false)}>Pricing</a><LaunchLink /></div>}
  </header>;
}

function Hero() {
  const [word, setWord] = useState(0);
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (!motion.matches && !document.hidden) timer = setInterval(() => setWord(i => (i + 1) % 3), 4200);
    };
    sync(); motion.addEventListener('change', sync); document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); motion.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync); };
  }, []);
  const metrics = [['200', 'questions per deposit', 'PRIVATE CREDITS'], ['0.05', 'tUSDC per question', 'SIMPLE BY DESIGN'], ['3', 'layers of privacy', 'BUILT INTO THE FLOW'], ['100%', 'open source', 'VERIFY IT YOURSELF']];
  return <section className="hero">
    <div className="hero-grid" aria-hidden="true" /><AsciiGlobe />
    <div className="hero-content container">
      <Eyebrow>A private way to use AI</Eyebrow>
      <h1>The freedom<br />to <span className="rotating-word" aria-hidden="true">{['ask', 'think', 'explore'].map((text, i) => <span key={text} className={`rotating-word-item ${i === word ? 'is-current' : i === (word + 2) % 3 ? 'is-previous' : ''}`}>{text}</span>)}</span><span className="sr-only">ask privately</span></h1>
      <div className="hero-bottom"><p>Your questions. Your business.<br />Get the answers you need, without sharing<br className="desktop-break" /> everything that makes you, you.</p><div className="hero-actions"><LaunchLink /><a className="button button-light" href="#how-it-works">See how it works <ArrowRight size={16} /></a></div></div>
    </div>
    <div className="hero-metrics" aria-label="Brizo at a glance">{metrics.map(([value, description, label]) => <div className="hero-metric" key={label}><strong>{value}</strong><div>{description}<span>{label}</span></div></div>)}</div>
  </section>;
}

function Process() {
  const [step, setStep] = useState(0);
  return <section className="process section-dark" id="how-it-works"><div className="container section-pad">
    <Eyebrow>The process</Eyebrow><h2>Three steps.<br /><span>Less left behind.</span></h2>
    <div className="process-grid"><div className="process-steps">{steps.map((s, i) => <button key={s.title} className={`process-step ${i === step ? 'active' : ''}`} aria-pressed={i === step} onClick={() => setStep(i)}><span className="roman">{['I', 'II', 'III'][i]}</span><span><span className="step-title">{s.title}</span><span className="step-description">{s.text}</span></span><ChevronRight size={20} /></button>)}</div>
    <div className="terminal"><div className="terminal-bar"><span className="window-dots"><i /><i /><i /></span><span>your-private-workflow</span><Code2 size={15} /></div><div className="terminal-code" aria-live="polite">{steps[step].code.map((line, i) => <div key={`${step}-${i}`}><span className="line-number">{i + 1}</span><code className={line.startsWith('//') ? 'code-comment' : ''}>{line || ' '}</code></div>)}</div><div className="terminal-footer"><span><i className="status-dot" />{['Ready to connect', 'You decide what leaves', 'Only you open the answer'][step]}</span><span>0{step + 1} / 03</span></div></div></div>
  </div></section>;
}

function DeveloperSection() {
  const [tab, setTab] = useState(0), [copied, setCopied] = useState(false);
  const snippets = [
    'GET /api/config\n\n// Public addresses and proving assets\n{\n  cluster: "devnet",\n  enclaveBoxPublicKey: "…",\n  circuit: { wasmUrl, zkeyUrl },\n  ready: { spend, faucet }\n}',
    'POST /api/ask\n\n// Encrypt locally. Prove locally.\n{\n  requestId, ciphertext, nonce,\n  clientPub,\n  proof,\n  publicSignals\n}',
    'GET /api/answer/:requestId\n\n// A sealed, single-use response\n{\n  requestId,\n  ciphertext, nonce,\n  spendTx\n}'
  ];
  async function copy() { try { await navigator.clipboard.writeText(snippets[tab]); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } }
  return <section className="container section-pad two-column" id="developers"><div><Eyebrow>For developers</Eyebrow><h2>Open code.<br /><span>Clear boundaries.</span></h2><p className="section-description">A small HTTP API. Proofs made in the browser. On-chain verification you can inspect. Build on the same pieces we do.</p><div className="developer-facts"><div><h3>TypeScript</h3><p>Across the app and gateway.</p></div><div><h3>Solana devnet</h3><p>Public, verifiable transactions.</p></div><div><h3>Client-side proving</h3><p>Your credit note stays local.</p></div><div><h3>Confidential compute</h3><p>Powered by Chainlink CRE.</p></div></div></div><div><div className="api-example"><div className="api-tabs"><div className="api-tablist" role="tablist" aria-label="API examples">{['Configure', 'Request', 'Answer'].map((label, i) => <button key={label} role="tab" id={`api-tab-${i}`} aria-controls="api-panel" aria-selected={i === tab} tabIndex={i === tab ? 0 : -1} onKeyDown={e => { const next = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1; if (next >= 0) { e.preventDefault(); setTab(next); document.getElementById(`api-tab-${next}`)?.focus(); } }} onClick={() => { setTab(i); setCopied(false); }}>{label}</button>)}</div><button className="icon-button" aria-label={copied ? 'Copied' : 'Copy API example'} onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><pre id="api-panel" role="tabpanel" aria-labelledby={`api-tab-${tab}`}>{snippets[tab]}</pre></div><div className="developer-links"><ExternalLink href={`${REPO}/blob/main/gateway/README.md`}>Read the API docs</ExternalLink><ExternalLink href={REPO}>View on GitHub</ExternalLink></div></div></section>;
}

export function Landing() {
  return <div className="landing"><Header /><main id="main-content"><Hero />
    <section className="container section-pad capabilities" id="features"><Eyebrow>Capabilities</Eyebrow><h2>Powerful answers.<br /><span>Personal boundaries.</span></h2><div className="feature-list">{features.map(({ title, text, icon: Icon, label }, i) => <article className="feature-row" key={title}><span className="feature-number">0{i + 1}</span><div><h3>{title}</h3><p>{text}</p></div><div className="feature-art" aria-hidden="true"><div className="feature-orbit"><Icon strokeWidth={1} size={48} /><i /><i /></div><span>{label}</span></div></article>)}</div></section>
    <Process />
    <section className="container section-pad infrastructure two-column"><div><Eyebrow>The infrastructure</Eyebrow><h2>Private by<br /><span>architecture.</span></h2><p className="section-description">Each part has a job. Your browser handles personal details. The workflow handles the model call. Solana handles the credits.</p><div className="architecture-stats"><div><strong>Local</strong><span>Personal data</span></div><div><strong>Sealed</strong><span>Questions & answers</span></div><div><strong>ZK</strong><span>Credit proofs</span></div></div></div><div className="network-visual"><AsciiGlobe small /><div className="network-card"><div className="network-heading"><span>THE REQUEST PATH</span><span className="mono">DEVNET DEMO</span></div>{[['01', 'Your browser', 'Scrub · encrypt · prove'], ['02', 'Confidential workflow', 'Decrypt · ask · seal'], ['03', 'Solana', 'Verify · record · settle']].map(([n, title, desc]) => <div className="network-row" key={n}><span>{n}</span><strong>{title}</strong><small>{desc}</small><ArrowUpRight size={16} /></div>)}</div></div></section>
    <section className="integrations"><div className="container"><Eyebrow>Built on open technology</Eyebrow><div className="integration-logos"><span className="solana-word"><i>≋</i> SOLANA</span><span className="chainlink-word"><i>⬡</i> Chainlink</span><span>OpenRouter <ArrowUpRight size={24} /></span><span className="mono">snarkjs<span className="tiny-tag">ZK</span></span><span>Ollama <span className="tiny-tag">LOCAL</span></span></div></div></section>
    <section className="privacy" id="privacy"><div className="container section-pad two-column"><div><Eyebrow>Privacy, with perspective</Eyebrow><h2>Your trust.<br /><span>Never taken for granted.</span></h2><p className="section-description">Privacy should be understandable. Here’s what Brizo protects, and where the boundaries are.</p><ExternalLink href={`${REPO}/blob/main/docs/SPEC.md`}>Read the threat model</ExternalLink></div><div className="privacy-points">{[[LockKeyhole, 'Review before you send', 'Inspect the exact outgoing text. Rules-only mode is clearly labelled and requires your review.'], [Fingerprint, 'A proof, not an identity', 'A credit proof hides its source deposit. Payment privacy still depends on the size of the depositor pool.'], [ShieldCheck, 'Honest about the limits', 'The gateway sees IPs and timing. Scrubbing can miss details. The demo uses CRE simulation and unaudited cryptography.']].map(([Icon, title, desc]) => { const I = Icon as typeof LockKeyhole; return <article key={String(title)}><div className="privacy-icon"><I size={23} strokeWidth={1.4} /></div><div><h3>{String(title)}</h3><p>{String(desc)}</p></div></article>; })}</div></div></section>
    <DeveloperSection />
    <section className="pricing container section-pad" id="pricing"><Eyebrow>Simple credits</Eyebrow><div className="pricing-heading"><h2>A little credit.<br /><span>A lot to ask.</span></h2><p>No subscription. No recurring payment.<br />Try the full flow with free devnet tokens.</p></div><div className="pricing-grid"><article className="price-card"><span className="mono">01 / EXPLORE</span><h3>Take a look around.</h3><p>See the privacy check in action.</p><div className="price-value">Free<span>to explore</span></div><ul><li><Check />Try a sample question</li><li><Check />Inspect the privacy diff</li><li><Check />No wallet needed to preview</li></ul><LaunchLink secondary>Try the workspace</LaunchLink></article><article className="price-card price-card-featured"><span className="price-badge">THE FULL EXPERIENCE</span><span className="mono">02 / ASK PRIVATELY</span><h3>Your next 200 questions.</h3><p>One deposit. Credits you control.</p><div className="price-value">10<span>tUSDC / 200 credits</span></div><ul><li><Check />0.05 tUSDC per question</li><li><Check />Client-side zero-knowledge proofs</li><li><Check />Encrypted questions and answers</li><li><Check />Exportable credit-note backup</li></ul><LaunchLink>Get test credits</LaunchLink></article><article className="price-card"><span className="mono">03 / BUILD</span><h3>Make it your own.</h3><p>Explore the pieces behind Brizo.</p><div className="price-value price-word">Open<span>source code</span></div><ul><li><Check />Gateway API documentation</li><li><Check />Solana program and circuits</li><li><Check />CRE workflow source</li></ul><a className="button button-light" href={REPO} target="_blank" rel="noreferrer">Explore the code<ArrowUpRight size={17} /></a></article></div><p className="pricing-note">Test tokens only. This demo runs on Solana devnet. No real funds required.</p></section>
    <section className="container faq-section"><Eyebrow>A few things to know</Eyebrow><div className="faq-layout"><h2>Good questions.<br /><span>Clear answers.</span></h2><div className="faq-list">{faqs.map(([q, a]) => <details key={q}><summary>{q}<Plus size={18} className="faq-plus" /><Minus size={18} className="faq-minus" /></summary><p>{a}</p></details>)}</div></div></section>
    <section className="final-cta container"><div className="cta-grid" aria-hidden="true" /><div><Eyebrow>Curiosity, with boundaries</Eyebrow><h2>Some things<br />are yours to ask.</h2><p>Bring your questions. Keep your personal details close.</p><LaunchLink>Start asking privately</LaunchLink><span className="cta-footnote">Free test tokens. Your wallet stays in your control.</span></div><div className="cta-art" aria-hidden="true"><Fingerprint size={240} strokeWidth={.45} /><div className="orbit-line" /><div className="orbit-line orbit-line-two" /></div></section>
    </main><footer className="site-footer container"><div className="footer-top"><div><Logo /><p>Frontier intelligence.<br />Personal boundaries.</p></div><div><h3>Explore</h3><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#pricing">Credits</a></div><div><h3>Build</h3><a href={`${REPO}/blob/main/gateway/README.md`} target="_blank" rel="noreferrer">API documentation</a><a href={REPO} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={12} /></a><a href={`${REPO}/blob/main/docs/EVIDENCE.md`} target="_blank" rel="noreferrer">Devnet evidence</a></div><div><h3>Understand</h3><a href="#privacy">Privacy & limitations</a><a href={`${REPO}/blob/main/docs/SPEC.md`} target="_blank" rel="noreferrer">Architecture</a><a href="#app">Open workspace <ArrowUpRight size={12} /></a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Brizo</span><span className="mono"><span className="status-dot" /> BUILT FOR TOKEN2049 ORIGINS · DEVNET</span></div></footer></div>;
}
