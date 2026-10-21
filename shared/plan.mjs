/*
  The planner: transcript → storyboard, with rules instead of a model.

  It reads the words and their timing and makes the calls a human editor
  makes on a talking-head first pass:
    · drop filler words, stutters and repeated phrases
    · spot retakes ("Here are three ways to get, um… Here are three ways to get
      your first customer") and keep the last take
    · drop throat-clearing openers ("Hey guys, welcome back")
    · split the talk into sections: hook, list items ("First…", "Second…"),
      wrap-up, call to action
    · suggest graphics: a hook headline, a name lower third, a chapter marker
      per list item, a stat callout wherever a number is said, a CTA end card
    · alternate punch-in zoom between jump cuts, soft transitions between sections

  Everything it decides is written into the storyboard with a reason, so the UI
  can show it and the user can undo any of it. Silence removal isn't decided
  here: it happens when shots become ranges (timeline.mjs), so changing the gap
  setting never needs a re-plan.

  Pure module: runs in Node and in the browser.
*/
import { tok, isFiller, endsSentence, titleFrom, asLine, joinWords, stripMarker } from './text.mjs';

export const DEFAULT_SETTINGS = {
  aspect: '9:16',
  resolution: 1080,
  fps: 30,
  theme: 'dark',
  lut: { id: 'paper', intensity: 0.8 },
  captions: { on: true, style: 'phrase', font: 'sans', size: 1 },
  cut: { minGap: 0.4, padIn: 0.08, padOut: 0.12 },
  clean: { fillers: true, repeats: true, retakes: true, intros: true },
  zoom: { punchIn: true, amount: 1.1 },
  framing: { fx: 0.5, fy: 0.42 },
  sectionTransition: { type: 'fade', duration: 0.3 },
  chapters: 'overlay',
  graphics: { headline: true, lowerThird: true, stats: true, cta: true },
  brand: { name: '', role: '', plate: '', text: '', accent: '', display: '', body: '' },   // shared/brand.mjs
  audio: { polish: true, loudness: -14, music: null, musicDb: -24 },
  encoder: 'x264',
};

/** Deep-ish merge for settings: one level of nested objects. */
export function withDefaults(settings = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(settings || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && DEFAULT_SETTINGS[k] && typeof DEFAULT_SETTINGS[k] === 'object'
      ? { ...DEFAULT_SETTINGS[k], ...v }
      : v;
  }
  return out;
}

const LIST_RE = /^(and |so |okay,? |ok,? )?((the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|next|final|last)( (thing|way|step|reason|tip|lesson|mistake|rule|one|idea|point))?\b|firstly|secondly|thirdly|lastly|finally|(number|step|tip|rule|lesson) (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b)/i;
const CTA_RE = /\b(comment|follow (me|along|for)|subscribe|link in (my |the )?bio|dm me|send me a dm|check out|sign up|join (the|my|us)|grab (the|my)|download)\b/i;
const WRAP_RE = /^(so,? |anyway,? |bottom line|to (sum|wrap|recap)|in short|that'?s (it|all)|the takeaway)/i;
const INTRO_RE = /^(hey|hi|hello|what'?s up|yo)\b[^.?!]{0,30}\b(guys|everyone|everybody|y'?all|folks|there|friends)\b|^welcome (back )?to\b|^in (this|today'?s) video\b|^(hey|hi),? (i'?m|it'?s) \w+/i;
const STAT_RE = /^(\$?\d[\d,.]*(%|x|k|m|b)?|\d+(st|nd|rd|th))$/i;
const MAGNITUDE = /^(percent|%|x|times|million|billion|thousand|hundred|k|grand|dollars|bucks)$/i;

/** Sentences as arrays of word indices. Split on terminal punctuation or a long pause. */
export function sentences(words, gap = 1.0, maxWords = 32) {
  const out = [];
  let cur = [];
  for (let k = 0; k < words.length; k++) {
    cur.push(k);
    const w = words[k], next = words[k + 1];
    const pause = next ? next.start - w.end : Infinity;
    if (endsSentence(w.text) || pause > gap || !next) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  // Very long run-ons are hard to edit as one card: split at the comma nearest the middle.
  const fin = [];
  for (const s of out) {
    if (s.length <= maxWords) { fin.push(s); continue; }
    let best = -1, bestD = Infinity;
    s.forEach((k, j) => {
      if (j < 6 || j > s.length - 6) return;
      if (/[,;:]$/.test(words[k].text)) { const d = Math.abs(j - s.length / 2); if (d < bestD) { bestD = d; best = j; } }
    });
    if (best < 0) best = Math.floor(s.length / 2) - 1;
    fin.push(s.slice(0, best + 1), s.slice(best + 1));
  }
  return fin;
}

const contentToks = (idx, words) => idx.filter(k => !isFiller(words[k])).map(k => tok(words[k].text)).filter(Boolean);

function commonPrefix(a, b) {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

function lcs(a, b) {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
  Is sentence A an abandoned or redone take of sentence B?
  Incomplete takes (no full stop, trailing comma or filler) only need to share
  B's opening words. Complete takes must be almost entirely contained in B,
  so parallel lines like "I want X. I want Y." are left alone.
*/
export function isRetake(aIdx, bIdx, words) {
  const a = contentToks(aIdx, words), b = contentToks(bIdx, words);
  if (a.length < 2 || b.length < 2) return false;
  const lastA = words[aIdx[aIdx.length - 1]];
  const lastContent = [...aIdx].reverse().find(k => !isFiller(words[k]));
  const incomplete = isFiller(lastA) || !endsSentence(lastA.text) || /[,-]$/.test(words[lastContent]?.text || '');
  const pre = commonPrefix(a, b);
  if (incomplete && pre >= 2 && pre >= 0.6 * a.length) return true;
  return a.length >= 3 && pre >= 2 && lcs(a, b) >= 0.85 * a.length;
}

/** Word indices to cut inside one sentence: fillers, stutters ("I I"), repeated phrases ("the offer, the offer"). */
export function inSentenceCuts(idx, words, clean) {
  const cut = {};
  if (clean.fillers) for (const k of idx) if (isFiller(words[k])) cut[k] = 'filler';
  if (clean.repeats) {
    const live = idx.filter(k => !(k in cut));
    const t = live.map(k => tok(words[k].text));
    for (let n = 4; n >= 1; n--) {
      for (let j = 0; j + 2 * n <= live.length; j++) {
        if (live.slice(j, j + n).some(k => k in cut)) continue;
        let same = true;
        for (let m = 0; m < n; m++) if (!t[j + m] || t[j + m] !== t[j + n + m]) { same = false; break; }
        // A single repeated word only counts if it isn't a legit double ("had had", "that that").
        if (same && n === 1 && ['had', 'that', 'is', 'very', 'no', 'bye', 'really'].includes(t[j])) same = false;
        if (same) for (let m = 0; m < n; m++) cut[live[j + m]] = 'repeat';
      }
    }
  }
  return cut;
}

/** "70%", "$5,000", "10x", "3 million users" → { value, word } at the first number in the sentence. */
export function findStat(idx, words) {
  for (let j = 0; j < idx.length; j++) {
    const raw = words[idx[j]].text.replace(/[,.;:!?]+$/, '');
    if (!STAT_RE.test(raw) || !/\d/.test(raw)) continue;
    const next = words[idx[j + 1]]?.text.replace(/[,.;:!?]+$/, '') || '';
    const strong = /[%$x]|k$|m$|b$/i.test(raw) || MAGNITUDE.test(next) || Number(raw.replace(/[^\d.]/g, '')) >= 100;
    if (!strong) continue;
    let value = raw;
    let rest = idx.slice(j + 1);
    if (/^(percent)$/i.test(next)) { value += '%'; rest = rest.slice(1); }
    else if (/^(million|billion|thousand)$/i.test(next)) { value += ' ' + next.toLowerCase(); rest = rest.slice(1); }
    // The label is what the number counts: the rest of its clause, as spoken.
    let label = joinWords(rest.map(k => words[k])).split(/,\s|;\s|[.?!](\s|$)/)[0].trim();
    if (label.split(/\s+/).length > 7) label = label.split(/\s+/).slice(0, 6).join(' ');
    return { value, label, word: idx[j] };
  }
  return null;
}

/** The word after "comment" in a CTA, if it's said like a keyword. */
function ctaWord(idx, words) {
  for (let j = 0; j < idx.length - 1; j++) {
    if (tok(words[idx[j]].text) === 'comment') {
      const w = words[idx[j + 1]].text.replace(/[^\p{L}\p{N}]/gu, '');
      if (w && !/^(below|down|on|the|a|and|if|with|your)$/i.test(w)) return w.toUpperCase();
    }
  }
  return null;
}

let seq = 0;
const id = p => `${p}${(++seq).toString(36)}`;

/**
  Build a storyboard.
  words: cleaned transcript words. scenes: source times where the picture
  changes (camera cuts in the footage). settings: project settings.
*/
export function plan(words, { settings: rawSettings, scenes = [] } = {}) {
  seq = 0;
  const settings = withDefaults(rawSettings);
  const clean = settings.clean;
  const sents = sentences(words);

  // 1. Classify sentences.
  const info = sents.map((idx, k) => {
    const text = joinWords(idx.map(i => words[i]));
    const content = contentToks(idx, words);
    return { idx, k, text, content, cut: inSentenceCuts(idx, words, clean), drop: null };
  });
  for (const s of info) {
    if (s.content.length === 0) s.drop = { type: 'filler', note: 'Only filler words' };
  }
  if (clean.retakes) {
    for (let k = 0; k < info.length; k++) {
      if (info[k].drop) continue;
      for (let j = k + 1; j <= Math.min(k + 3, info.length - 1); j++) {
        if (info[j].drop) continue;
        if (isRetake(info[k].idx, info[j].idx, words)) {
          info[k].drop = { type: 'retake', note: `Retake: kept the later take ("${info[j].text.slice(0, 48)}${info[j].text.length > 48 ? '…' : ''}")` };
          break;
        }
      }
    }
  }
  if (clean.intros) {
    const first = info.find(s => !s.drop);
    if (first && INTRO_RE.test(first.text) && info.filter(s => !s.drop).length > 2) {
      first.drop = { type: 'intro', note: 'Throat-clearing opener. Starting on the first real line is a stronger hook.' };
    }
  }

  // 2. Sections.
  const sections = [];
  const newSection = (kind, title, n) => { const s = { id: id('sec'), kind, title, n }; sections.push(s); return s; };
  let sec = newSection('hook', 'Hook');
  let listN = 0, inCta = false;
  const live = info.filter(s => !s.drop);
  for (let j = 0; j < live.length; j++) {
    const s = live[j];
    const prevEnd = j > 0 ? words[live[j - 1].idx[live[j - 1].idx.length - 1]].end : 0;
    const pause = words[s.idx[0]].start - prevEnd;
    const body = s.text.replace(/^[^\p{L}\p{N}]+/u, '');
    if (!inCta && CTA_RE.test(body) && j >= live.length - 3 && j > 0) {
      inCta = true;
      sec = newSection('cta', 'Call to action');
    } else if (!inCta && LIST_RE.test(body) && j > 0) {
      listN++;
      sec = newSection('item', titleFrom(body), listN);
    } else if (!inCta && listN > 0 && sec.kind === 'item' && WRAP_RE.test(body) && pause > 0.8) {
      sec = newSection('wrap', 'Wrap-up');
    } else if (!inCta && listN === 0 && j > 0 && pause > 1.6 && sec.count >= 3) {
      sec = newSection('part', titleFrom(body));
    }
    s.section = sec.id;
    sec.count = (sec.count || 0) + 1;
  }
  if (sections.length > 1 && sections[0].count >= 4) sections[0].title = 'Intro';
  // Dropped sentences sit in the section of the next live sentence (or the last one).
  for (let k = info.length - 1, next = sections[sections.length - 1].id; k >= 0; k--) {
    if (info[k].section) next = info[k].section;
    else info[k].section = next;
  }

  // 3. Shots: one per sentence; split where the footage itself cuts to another camera.
  const shots = [];
  for (const s of info) {
    let parts = [s.idx];
    const cutsIn = scenes.filter(t => t > words[s.idx[0]].start + 0.3 && t < words[s.idx[s.idx.length - 1]].end - 0.3);
    if (cutsIn.length) {
      parts = [];
      let cur = [];
      for (const k of s.idx) {
        if (cur.length && cutsIn.some(t => words[cur[cur.length - 1]].end <= t && words[k].start >= t - 0.05)) { parts.push(cur); cur = []; }
        cur.push(k);
      }
      parts.push(cur);
    }
    for (const p of parts) {
      const cut = {};
      for (const k of p) if (k in s.cut) cut[k] = s.cut[k];
      shots.push({
        id: id('s'),
        kind: 'talk',
        section: s.section,
        w0: p[0],
        w1: p[p.length - 1],
        cut,
        enabled: !s.drop,
        flag: s.drop || null,
        transition: { type: 'cut', duration: settings.sectionTransition.duration },
        overlays: [],
        _sent: s,
      });
    }
  }

  // 4. Framing, transitions and graphics.
  const enabled = shots.filter(x => x.enabled);
  // The name lower third goes where the speaker introduces themself ("I'm Sam"), else on shot 2.
  const firstName = String(settings.brand?.name || '').split(/\s+/)[0];
  let introShot = -1, introWord = null;
  if (firstName) {
    const re = new RegExp(`\\b(i'?m|i am|my name is|name'?s|this is)\\s+${firstName.replace(/[^\p{L}]/gu, '')}\\b`, 'iu');
    introShot = enabled.findIndex(sh => re.test(joinWords(words.slice(sh.w0, sh.w1 + 1))));
    if (introShot >= 0) introWord = enabled[introShot].w0 + words.slice(enabled[introShot].w0, enabled[introShot].w1 + 1).findIndex(w => tok(w.text) === tok(firstName));
  }
  if (introShot < 0) introShot = Math.min(1, enabled.length - 1);
  let lastSection = null, parity = 0;
  const secById = new Map(sections.map(x => [x.id, x]));
  enabled.forEach((shot, j) => {
    const sec = secById.get(shot.section);
    const first = shot.section !== lastSection;
    // A camera change in the footage already hides the jump; punch-ins only cover same-angle cuts.
    const camCut = scenes.some(t => Math.abs(t - words[shot.w0].start) < 0.5);
    if (first) {
      parity = 0;
      if (j > 0) shot.transition = { ...settings.sectionTransition };
    } else parity = camCut ? 0 : parity + 1;
    if (settings.zoom.punchIn && parity % 2 === 1) shot.zoom = settings.zoom.amount;
    lastSection = shot.section;

    const text = shot._sent.text;
    if (first && sec.kind === 'item' && settings.chapters === 'overlay') {
      shot.overlays.push({ id: id('o'), type: 'chapter', eyebrow: String(sec.n).padStart(2, '0'), text: sec.title, at: 0.15, dur: 3.2 });
    }
    if (j === 0 && settings.graphics.headline) {
      shot.overlays.push({ id: id('o'), type: 'headline', text: asLine(text.split(/\s+/).length <= 14 ? text.replace(/[.?!]+$/, '') : titleFrom(text, 8)), at: 0.1, dur: 'shot' });
    }
    if (j === introShot && settings.graphics.lowerThird && settings.brand?.name) {
      shot.overlays.push({ id: id('o'), type: 'lowerThird', text: settings.brand.name, sub: settings.brand.role || '', at: 0.3, dur: 3.5, ...(introWord != null ? { word: introWord } : {}) });
    }
    const hasHeadline = shot.overlays.some(o => o.type === 'headline');
    if (settings.graphics.stats && sec.kind !== 'cta' && !hasHeadline) {
      const st = findStat(shot._sent.idx.filter(k => k >= shot.w0 && k <= shot.w1), words);
      if (st) shot.overlays.push({ id: id('o'), type: 'stat', text: st.value, sub: st.label, word: st.word, dur: 3 });
    }
    if (sec.kind === 'cta' && settings.graphics.cta && first) {
      const kw = ctaWord(shot._sent.idx, words);
      const want = /\b(?:want|need|get|grab)\s+(?:the|my|a)?\s*([^,.]+)/i.exec(stripMarker(text));
      shot.overlays.push({
        id: id('o'),
        type: 'cta',
        text: kw ? `Comment ${kw}.` : asLine(titleFrom(text, 4)),
        sub: want ? `For ${want[1].trim().startsWith('the') ? '' : 'the '}${want[1].trim()}` : '',
        keyword: kw || '',
        at: 0.2,
        dur: 'shot',
      });
    }
  });

  // Card-mode chapters: a title card shot in front of each list section.
  if (settings.chapters === 'card') {
    for (const sec of sections.filter(x => x.kind === 'item')) {
      const at = shots.findIndex(x => x.section === sec.id && x.enabled);
      if (at < 0) continue;
      shots.splice(at, 0, {
        id: id('s'), kind: 'card', section: sec.id, enabled: true,
        card: { eyebrow: String(sec.n).padStart(2, '0'), title: asLine(sec.title), sub: '', dur: 1.8 },
        transition: { ...settings.sectionTransition }, overlays: [],
      });
      const after = shots[at + 1];
      if (after) after.transition = { ...settings.sectionTransition };
    }
  }

  for (const s of shots) delete s._sent;
  for (const s of sections) delete s.count;
  return {
    sections,
    shots,
    stats: {
      sentences: info.length,
      retakes: info.filter(s => s.drop?.type === 'retake').length,
      intros: info.filter(s => s.drop?.type === 'intro').length,
      fillers: shots.reduce((n, s) => n + Object.values(s.cut || {}).filter(v => v === 'filler').length, 0),
      repeats: shots.reduce((n, s) => n + Object.values(s.cut || {}).filter(v => v === 'repeat').length, 0),
    },
  };
}
