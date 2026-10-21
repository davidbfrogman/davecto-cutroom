/*
  Word-level text helpers shared by the planner, the timeline and the UI.
  Pure functions, no Node or DOM APIs, so the browser can import this file too.
*/

export const FILLERS = new Set(['um', 'uh', 'umm', 'uhm', 'uhh', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm', 'eh']);

/** Lowercase, accent-folded, letters/digits/%/$ only. "Build," → "build", "70%" → "70%". */
export function tok(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}%$]/gu, '');
}

export const isFiller = w => FILLERS.has(tok(w.text));

/** Ends a sentence: a terminal mark, optionally followed by closing quotes or brackets. */
export const endsSentence = text => /[.?!…]["'”’)\]]*$/.test(text);

/**
  Tidy raw recogniser output: trim, drop empties, glue punctuation-only tokens
  ("%", ",") onto the word before, force times to be monotonic, number the words.
*/
export function cleanWords(raw, duration = Infinity) {
  const out = [];
  for (const w of raw) {
    const rawText = String(w.text ?? w.word ?? '');
    const text = rawText.trim();
    if (!text) continue;
    let start = Math.max(0, Number(w.start) || 0);
    let end = Math.min(duration, Math.max(start, Number(w.end) || start));
    const prev = out[out.length - 1];
    // Whisper splits "160,000" into " 160" + ",000" and "over-engineering" into " over" + "-engineering".
    // A piece with no leading space that starts with punctuation belongs to the word before.
    const continues = prev && ((/^\S/.test(rawText) && /^[^\p{L}]/u.test(text)) || /-$/.test(prev.text));
    if (prev && (continues || /^[^\p{L}\p{N}]+$/u.test(text))) {
      prev.text += text;
      prev.end = Math.max(prev.end, end);
      continue;
    }
    if (prev && start < prev.start) start = prev.start;
    if (end < start) end = start;
    out.push({ text, start: round3(start), end: round3(end), p: w.p ?? w.probability ?? 1 });
  }
  return out.map((w, i) => ({ i, ...w }));
}

export const round3 = x => Math.round(x * 1000) / 1000;

const SMALL = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'but', 'so', 'for', 'in', 'on', 'at', 'by', 'with', 'is', 'are', 'was', 'be', 'that', 'this', 'it', 'its', 'your', 'my', 'our', 'their', 'who', 'which', 'just', 'really', 'very', 'already']);

/** Strip a leading list marker like "First," / "Number two:" / "The third thing is". */
export function stripMarker(text) {
  return text
    .replace(/^(and |so |okay,? |ok,? )?(the )?(first|second|third|fourth|fifth|sixth|seventh|next|final|last|another)( (thing|way|step|reason|tip|lesson|mistake|rule|one|idea|point))?( (is|you need|you should|i want to)?)?[,:.]?\s*/i, '')
    .replace(/^(firstly|secondly|thirdly|finally|lastly)[,:.]?\s*/i, '')
    .replace(/^(number|step|tip|rule|lesson) (\d+|one|two|three|four|five|six|seven|eight|nine|ten)[,:.]?\s*/i, '')
    .trim();
}

/**
  Turn a spoken sentence into a short on-screen title: drop a list marker, keep
  the first clause, stop before a relative clause, cap the length, trim weak
  trailing words. "Second, talk to the people who already complain." → "Talk to the people".
*/
export function titleFrom(text, maxWords = 6) {
  let s = stripMarker(text).split(/,\s|;|:\s|—|–|\.\s|[.?!]$/)[0] || text;
  let words = s.replace(/[.?!"“”]/g, '').trim().split(/\s+/).filter(Boolean);
  const rel = words.findIndex((w, k) => k >= 2 && /^(who|which|that|because|so|when|where|if)$/i.test(w));
  if (rel > 0 && rel <= maxWords + 1) words = words.slice(0, rel);
  words = words.slice(0, maxWords);
  while (words.length > 2 && SMALL.has(tok(words[words.length - 1]))) words.pop();
  const out = words.join(' ');
  return out ? out[0].toUpperCase() + out.slice(1) : '';
}

/** Sentence case with a final period, for headline-style overlays. */
export function asLine(text) {
  const s = String(text).trim().replace(/\s+/g, ' ');
  if (!s) return s;
  const c = s[0].toUpperCase() + s.slice(1);
  return /[.?!]$/.test(c) ? c : c + '.';
}

export const joinWords = ws => ws.map(w => w.text).join(' ').replace(/\s+([,.;:?!%])/g, '$1');
