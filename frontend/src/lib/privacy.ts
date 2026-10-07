export type Profile = { name: string; age: string; city: string; privateTerms: string };
export const emptyProfile: Profile = { name: '', age: '', city: '', privateTerms: '' };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export type PrivacyReview = { text: string; removed: string[]; flagged: string[]; mode: 'rules' | 'ollama' };

export function scrub(question: string, profile: Profile): PrivacyReview {
  let text = question;
  const removed: string[] = [];
  const replace = (expression: RegExp, replacement: string, label: string) => {
    if (expression.test(text)) { text = text.replace(expression, replacement); removed.push(label); }
  };
  replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]', 'Email address');
  replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[date removed]', 'Exact date');
  replace(/(?:\+?\d[\d ().-]{7,}\d)/g, '[number removed]', 'Phone or identifying number');
  const terms = [...new Set([profile.name, ...profile.name.split(/\s+/).filter(v => v.length > 1), ...profile.privateTerms.split(/[\n,]+/)].map(s => s.trim()).filter(Boolean))].sort((a,b) => b.length - a.length);
  for (const term of terms) replace(new RegExp(escape(term), 'gi'), '[private detail]', 'Personal detail');
  if (profile.city.trim()) replace(new RegExp(escape(profile.city.trim()), 'gi'), 'a city', 'Exact location');
  if (/^\d{1,3}$/.test(profile.age) && Number(profile.age) <= 120) replace(new RegExp(`(?<!\\d)${profile.age}(?!\\d)`, 'g'), `in their ${Math.floor(Number(profile.age) / 10) * 10}s`, 'Exact age');
  const flagged = [...new Set(text.match(/\b[A-Z][a-z]{2,}\b|\b\d+(?:\.\d+)?\b/g) ?? [])].slice(0, 30);
  return { text, removed: [...new Set(removed)], flagged, mode: 'rules' };
}
export async function rewriteLocally(question: string, profile: Profile): Promise<PrivacyReview> {
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45_000), // allows a cold model load
    // think: false — qwen3's hidden reasoning made a one-line rewrite take ~20 s (~450 tokens); off, it takes 1–3 s.
    body: JSON.stringify({ model: 'qwen3:8b', stream: false, think: false, format: 'json', messages: [
      { role: 'system', content: 'Rewrite this question in neutral third person. Remove names, employers, exact locations, identifiers, dates and personal numbers. Preserve its general intent. Output JSON {"question": string}. Do not answer the question. Do not invent facts.' },
      { role: 'user', content: JSON.stringify({ question, profile }) },
    ] }),
  });
  if (!response.ok) throw new Error('Ollama is unavailable. Use the local rules check, or start qwen3:8b on this device.');
  const data = await response.json();
  const parsed = JSON.parse(data.message?.content ?? '{}');
  if (typeof parsed.question !== 'string' || !parsed.question.trim() || parsed.question.length > 10_000) throw new Error('The local model did not return a usable question. Use the rules check instead.');
  return { ...scrub(parsed.question, profile), mode: 'ollama' };
}

export function personaliseAnswer(raw: string, profile: Profile): { general: string; advice: string[]; caveats: string; formatted: boolean } {
  try {
    const data = JSON.parse(raw);
    if (typeof data.general !== 'string') throw new Error();
    const advice: string[] = [];
    for (const b of Array.isArray(data.branches) ? data.branches : []) {
      const when = b?.when;
      if (!when || typeof b.advice !== 'string') continue;
      const actual = when.field === 'age' && profile.age !== '' ? Number(profile.age) : when.field === 'city' ? profile.city : undefined;
      if (actual === undefined || actual === '') continue;
      const numeric = typeof actual === 'number' && typeof when.value === 'number';
      const match = when.op === 'eq' ? actual === when.value : numeric && (when.op === 'lt' ? actual < when.value : when.op === 'lte' ? actual <= when.value : when.op === 'gt' ? actual > when.value : when.op === 'gte' ? actual >= when.value : false);
      if (match) advice.push(b.advice);
    }
    return { general: data.general, advice, caveats: typeof data.caveats === 'string' ? data.caveats : '', formatted: true };
  } catch { return { general: raw, advice: [], caveats: '', formatted: false }; }
}
