export type Profile = { name: string; age: string; city: string; privateTerms: string };
export const emptyProfile: Profile = { name: '', age: '', city: '', privateTerms: '' };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export type PrivacyReview = { text: string; removed: string[]; flagged: string[]; mode: 'rules' | 'ollama' };

// Capitalised words that are not personal identifiers (sentence starters, days, months, common nouns).
const COMMON_CAPITALISED = new Set(['I', 'My', 'The', 'A', 'An', 'How', 'What', 'Why', 'When', 'Where', 'Which', 'Who', 'Should', 'Can', 'Could', 'Would', 'Is', 'Are', 'Do', 'Does', 'Did', 'He', 'She', 'They', 'We', 'You', 'It', 'This', 'That', 'Please', 'Hi', 'Hello', 'Thanks', 'If', 'And', 'But', 'Or', 'So', 'In', 'On', 'At', 'For', 'With', 'To', 'From', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'English', 'AI', 'Solana', 'Ollama']);

export function scrub(question: string, profile: Profile): PrivacyReview {
  let text = question;
  const removed: string[] = [];
  const replace = (expression: RegExp, replacement: string | ((...args: any[]) => string), label: string) => {
    expression.lastIndex = 0;
    if (!expression.test(text)) return;
    expression.lastIndex = 0;
    const next = text.replace(expression, replacement as any);
    if (next !== text) { text = next; removed.push(label); }
  };
  replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]', 'Email address');
  replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[date removed]', 'Exact date');
  replace(/(?:\+?\d[\d ().-]{7,}\d)/g, '[number removed]', 'Phone or identifying number');
  const terms = [...new Set([profile.name, ...profile.name.split(/\s+/).filter(v => v.length > 1), ...profile.privateTerms.split(/[\n,]+/)].map(s => s.trim()).filter(Boolean))].sort((a,b) => b.length - a.length);
  for (const term of terms) replace(new RegExp(escape(term), 'gi'), '[private detail]', 'Personal detail');
  if (profile.city.trim()) replace(new RegExp(escape(profile.city.trim()), 'gi'), 'a city', 'Exact location');
  if (/^\d{1,3}$/.test(profile.age) && Number(profile.age) <= 120) replace(new RegExp(`(?<!\\d)${profile.age}(?!\\d)`, 'g'), `in their ${Math.floor(Number(profile.age) / 10) * 10}s`, 'Exact age');
  generaliseFreeText();
  const flagged = [...new Set(text.match(/\b[A-Z][a-z]{2,}\b|\b\d+(?:\.\d+)?\b/g) ?? [])].filter(w => !COMMON_CAPITALISED.has(w)).slice(0, 30);
  return { text, removed: [...new Set(removed)], flagged, mode: 'rules' };

  // Identifiers typed straight into the question (no profile needed). Rules-only mode is
  // what hosted users get, so names and ages must not leave just because the profile is empty.
  function generaliseFreeText() {
    const band = (n: number) => n < 13 ? 'a child' : n < 20 ? 'in their teens' : `in their ${Math.floor(n / 10) * 10}s`;
    const ageOk = (v: string) => Number(v) > 0 && Number(v) <= 120;
    // "aged 13" / "age 13" / "age of 13" → "in their teens"
    replace(/\b(?:aged|age of|age)\s+(\d{1,3})\b/gi, (m: string, n: string) => ageOk(n) ? band(Number(n)) : m, 'Exact age');
    // "34 years old" / "34-year-old" / "34 yo"
    replace(/\b(\d{1,3})(?:[\s-]*years?[\s-]*old|\s*y\/?o)\b/gi, (m: string, n: string) => ageOk(n) ? band(Number(n)) : m, 'Exact age');
    // "I am 34", "he's 23", "she is 41"
    replace(/\b(I am|I'm|he is|she is|he's|she's|they are|they're)\s+(\d{1,3})\b(?!\s*(?:%|kg|km|lb|mg|ng|ml|cm|times|hours|minutes|days|weeks|months))/gi, (m: string, who: string, n: string) => ageOk(n) ? `${who} ${band(Number(n))}` : m, 'Exact age');
    // "Soham Vijay, 23." — a number right after a comma and before the end of the clause
    replace(/,\s*(\d{1,3})(?=\s*(?:[.,;!?]|$|\b(?:and|who|from|living|lives|in|with)\b))/g, (m: string, n: string) => ageOk(n) ? `, ${band(Number(n))}` : m, 'Exact age');
    // Places after location cues
    replace(/\b(live in|lives in|living in|based in|from|moved to|staying in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g, (m: string, cue: string, place: string) => COMMON_CAPITALISED.has(place) ? m : `${cue} a city`, 'Exact location');
    // Full names and organisations: two or more capitalised words in a row
    replace(/\b[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|[A-Z]\.))+/g, (m: string) => m.split(/\s+/).every(w => COMMON_CAPITALISED.has(w)) ? m : '[private detail]', 'Name or organisation');
    // A single name after an introducing cue
    replace(/\b(named|called|name is|I am|I'm|my (?:client|friend|boss|colleague|partner|wife|husband|son|daughter|brother|sister|mother|father|doctor|manager|neighbour|neighbor)(?: is)?)\s+([A-Z][a-z]{1,})\b/g, (m: string, cue: string, name: string) => COMMON_CAPITALISED.has(name) ? m : `${cue} [private detail]`, 'Name');
  }
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
