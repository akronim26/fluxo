import type { ReactNode } from 'react';
import { ArrowUpRight, ArrowRight } from 'lucide-react';

export const REPO = 'https://github.com/akronim26/brizo';
export function Logo() { return <a href="#" className="brand" aria-label="Brizo home">brizo<span>™</span></a>; }
export function Eyebrow({ children }: { children: ReactNode }) { return <div className="eyebrow"><span />{children}</div>; }
export function LaunchLink({ children = 'Start asking', secondary = false }: { children?: ReactNode; secondary?: boolean }) {
  return <a className={`button ${secondary ? 'button-light' : 'button-dark'}`} href="#app">{children}<ArrowRight size={17} /></a>;
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="text-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={15} /></a>;
}
