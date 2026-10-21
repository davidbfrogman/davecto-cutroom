/*
  Cutroom graphics runtime. Deterministic: seek(t) sets every element from t
  alone, so the renderer can screenshot any frame and the editor preview shows
  exactly that frame.

  data = {
    width, height, theme: 'dark' | 'light',
    overlays: [{ id, type, start, end, props }],   // output seconds
    captions: [{ id, t0, t1, words: [{ text, t0, t1 }] }],
    captionStyle: 'phrase' | 'word',
    brand,                               // the user's colours and fonts: resolveBrand() in shared/brand.mjs
  }
*/

const IN = 0.5;       // entrance, seconds (Cutaways --t-in is .6; video reads a touch faster)
const OUT = 0.4;      // exit
const RISE = 10;      // stage px
const smooth = x => x * x * (3 - 2 * x);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

const ZONE = { headline: 'top', chapter: 'top', stat: 'top', keyword: 'top', quote: 'top', lowerThird: 'lower', cta: 'center', card: 'full' };

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.textContent = html;
  return e;
}

/*
  Templates. Each returns { el, parts } where parts animate in order:
  [element, kind ('up' | 'in' | 'draw'), delay].
*/
const T = {
  headline(p) {
    const root = el('div', 'cr-ov cr-headline'), plate = el('div', 'cr-plate'), br = el('i', 'cr-bracket'), t = el('div', 'cr-serif t', p.text || '');
    plate.append(br, t); root.append(plate);
    return { el: root, parts: [[plate, 'in', 0], [br, 'in', 0.1], [t, 'up', 0.08]] };
  },
  lowerThird(p) {
    const root = el('div', 'cr-ov cr-lower'), plate = el('div', 'cr-plate'), n = el('div', 'cr-serif n', p.text || ''), r = el('i', 'cr-rule teal'), s = el('div', 'cr-eyebrow', p.sub || '');
    plate.append(n, r, s); root.append(plate);
    return { el: root, parts: [[plate, 'in', 0], [n, 'up', 0.06], [r, 'draw', 0.14], [s, 'in', 0.2]] };
  },
  chapter(p) {
    const root = el('div', 'cr-ov cr-chapter'), plate = el('div', 'cr-plate'), e = el('div', 'cr-eyebrow teal', p.eyebrow || ''), r = el('i', 'cr-rule'), t = el('div', 'cr-serif t', p.text || '');
    plate.append(e, r, t); root.append(plate);
    return { el: root, parts: [[plate, 'in', 0], [e, 'in', 0.06], [r, 'draw', 0.1], [t, 'up', 0.14]] };
  },
  stat(p) {
    const root = el('div', 'cr-ov cr-stat'), plate = el('div', 'cr-plate'), v = el('div', 'cr-serif v', p.text || ''), s = el('div', 's', p.sub || '');
    plate.append(v); if (p.sub) plate.append(s); root.append(plate);
    return { el: root, parts: [[plate, 'in', 0], [v, 'up', 0.06], [s, 'in', 0.18]] };
  },
  keyword(p) {
    const root = el('div', 'cr-ov cr-keyword'), plate = el('div', 'cr-plate'), t = el('div', 'cr-serif t', p.text || '');
    plate.append(t); root.append(plate);
    return { el: root, parts: [[plate, 'in', 0], [t, 'up', 0.06]] };
  },
  quote(p) {
    const root = el('div', 'cr-ov cr-quote'), plate = el('div', 'cr-plate'), t = el('div', 't', p.text ? `“${p.text.replace(/^["“]|["”]$/g, '')}”` : ''), s = el('div', 'cr-eyebrow s', p.sub || '');
    plate.append(t); if (p.sub) plate.append(s); root.append(plate);
    return { el: root, parts: [[plate, 'in', 0], [t, 'up', 0.08], [s, 'in', 0.2]] };
  },
  cta(p) {
    const root = el('div', 'cr-ov cr-cta'), plate = el('div', 'cr-plate'), br = el('i', 'cr-bracket'), t = el('div', 'cr-serif t', p.text || ''), s = el('div', 's', p.sub || '');
    plate.append(br, t);
    if (p.sub) plate.append(s);
    const parts = [[plate, 'in', 0], [br, 'in', 0.1], [t, 'up', 0.08], [s, 'in', 0.2]];
    if (p.keyword) {
      const row = el('div', 'row'), av = el('span', 'av'), kw = el('span', 'kw', p.keyword), ar = el('span', 'cr-muted', '→');
      row.append(av, kw, ar); plate.append(row);
      parts.push([row, 'up', 0.32]);
    }
    root.append(plate);
    return { el: root, parts };
  },
  card(p) {
    const root = el('div', 'cr-ov cr-card'), br = el('i', 'br'), e = el('div', 'cr-eyebrow teal e', p.eyebrow || ''), t = el('div', 'cr-serif t', p.title || p.text || ''), s = el('div', 's', p.sub || '');
    root.append(br, e, t, s);
    return { el: root, parts: [[root, 'in', 0], [br, 'in', 0.12], [e, 'in', 0.16], [t, 'up', 0.2], [s, 'in', 0.32]] };
  },
};

function setPart(node, kind, p, q) {
  const e = smooth(clamp01(p));
  if (kind === 'draw') {
    node.style.transform = `scaleX(${e})`;
    node.style.opacity = String(q);
  } else if (kind === 'up') {
    node.style.opacity = String(e * q);
    node.style.transform = e < 1 ? `translateY(${((1 - e) * RISE).toFixed(2)}px)` : '';
  } else {
    node.style.opacity = String(e * q);
  }
}

class Runtime {
  constructor(root) {
    this.root = root;
    this.ready = true;
    this.items = [];
    this.caps = [];
  }

  /** Returns a promise when the brand needs font files, so the renderer can wait for them. */
  load(d) {
    this.d = d;
    document.documentElement.dataset.theme = d.theme === 'light' ? 'light' : 'dark';
    const layout = d.width < d.height ? 'v' : d.width > d.height ? 'h' : 'sq';
    const refW = layout === 'v' ? 360 : layout === 'h' ? 640 : 480;
    this.scale = d.width / refW;
    this.root.innerHTML = '';
    const stage = el('div', `cr-stage L-${layout}`);
    stage.style.width = `${refW}px`;
    stage.style.height = `${d.height / this.scale}px`;
    stage.style.transform = `scale(${this.scale})`;
    this.root.append(stage);
    this.stage = stage;
    const fonts = applyBrand(stage, d.brand);

    // One graphic per zone at a time: a newer one cuts the older one short.
    const ovs = (d.overlays || []).map(o => ({ ...o })).sort((a, b) => a.start - b.start);
    const last = {};
    for (const o of ovs) {
      const z = ZONE[o.type] || o.type;
      if (z === 'full') continue;
      const prev = last[z];
      if (prev && prev.end > o.start) prev.end = Math.max(prev.start + 0.6, o.start);
      last[z] = o;
    }

    this.items = [];
    for (const o of ovs) {
      const make = T[o.type];
      if (!make) continue;
      const { el: node, parts } = make({ ...o.props });
      node.style.display = 'none';
      stage.append(node);
      const settle = Math.max(...parts.map(p => p[2])) + IN;
      this.items.push({ o, node, parts, settle });
    }
    // Cards sit under everything else.
    for (const it of this.items) if (it.o.type === 'card') stage.prepend(it.node);

    this.capBox = el('div', `cr-caps ${d.captionStyle === 'word' ? 'word' : ''} ${d.brand?.caption?.serif ? 'serif' : ''}`);
    this.capBox.style.display = 'none';
    stage.append(this.capBox);
    this.caps = d.captions || [];
    this.capShown = null;
    return fonts.length ? Promise.all(fonts).then(() => true) : true;
  }

  seek(t) {
    for (const it of this.items) {
      const { o } = it;
      const on = t >= o.start && t < o.end;
      if (!on) { if (it.node.style.display !== 'none') it.node.style.display = 'none'; continue; }
      it.node.style.display = '';
      const local = t - o.start, rem = o.end - t;
      const q = rem < OUT ? smooth(clamp01(rem / OUT)) : 1;
      for (const [node, kind, delay] of it.parts) setPart(node, kind, (local - delay) / IN, q);
    }
    const c = this.captionAt(t);
    if (!c) { this.capBox.style.display = 'none'; this.capShown = null; }
    else {
      this.capBox.style.display = '';
      if (this.capShown !== c.id) {
        this.capBox.innerHTML = '';
        const plate = el('div', 'cr-plate');
        c.words.forEach((w, k) => { if (k) plate.append(' '); plate.append(el('span', 'w', w.text.replace(/'/g, '’'))); });   // curly apostrophes
        this.capBox.append(plate);
        this.capShown = c.id;
      }
      if (this.d.captionStyle === 'word') {
        const spans = this.capBox.querySelectorAll('.w');
        c.words.forEach((w, k) => spans[k].classList.toggle('on', t >= w.t0 - 0.02));
      }
    }
  }

  captionAt(t) {
    if (this.items.some(it => it.o.type === 'card' && t >= it.o.start && t < it.o.end)) return null;
    let lo = 0, hi = this.caps.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1, c = this.caps[m];
      if (t < c.t0) hi = m - 1; else if (t >= c.t1) lo = m + 1; else return c;
    }
    return null;
  }

  /** A string that changes exactly when the picture would. Equal signatures → identical frames. */
  signature(t) {
    let s = '';
    for (const it of this.items) {
      const { o } = it;
      if (t < o.start || t >= o.end) continue;
      const local = t - o.start, rem = o.end - t;
      s += local < it.settle || rem < OUT ? `${o.id}@${Math.round(t * 1000)}|` : `${o.id}|`;
    }
    const c = this.captionAt(t);
    if (c) {
      s += c.id;
      if (this.d.captionStyle === 'word') s += ':' + c.words.filter(w => t >= w.t0 - 0.02).length;
    }
    return s;
  }

  signatures(fps, n) {
    const out = new Array(n);
    for (let f = 0; f < n; f++) out[f] = this.signature(f / fps);
    return out;
  }
}

/*
  The user's brand: their colours replace the theme's tokens on this stage (muted text,
  hairlines and the card grid are mixed from them), their fonts replace Fraunces and
  Inter, and captions get their own font and size. Fonts that aren't bundled are
  loaded here; returns the promises.
*/
const loaded = new Map();
function applyBrand(stage, brand) {
  if (!brand) return [];
  const set = (k, v) => stage.style.setProperty(k, v);
  const { colors: c, custom } = brand;
  if (custom.plate) { set('--background', c.plate); set('--grid', `color-mix(in srgb, ${c.plate} 86%, ${c.text})`); }
  if (custom.text) set('--foreground', c.text);
  if (custom.plate || custom.text) {
    set('--muted-foreground', `color-mix(in srgb, ${c.text} 62%, ${c.plate})`);
    set('--border', `color-mix(in srgb, ${c.text} 16%, ${c.plate})`);
  }
  if (custom.accent) set('--accent', c.accent);
  if (brand.display) set('--serif', brand.display);
  if (brand.body) set('--sans', brand.body);
  if (brand.caption?.stack) set('--cap-font', brand.caption.stack);
  set('--cap-scale', String(brand.caption?.scale || 1));
  const out = [];
  for (const f of brand.fonts || []) {
    if (f.scope !== 'user') continue;   // bundled ones come from fonts.css
    if (!loaded.has(f.family)) {
      const face = new FontFace(f.family, `url("${f.url}")`, { weight: '100 900', display: 'block' });
      document.fonts.add(face);
      loaded.set(f.family, face.load().catch(() => null));
    }
    out.push(loaded.get(f.family));
  }
  return out;
}

const runtime = new Runtime(document.getElementById('cr-root'));
window.CR = runtime;

/* ---------- Sample gallery ---------- */

const SAMPLE = [
  { type: 'headline', props: { text: 'Most founders build for months before anyone pays them.' } },
  { type: 'lowerThird', props: { text: 'Your Name', sub: 'What you do' } },
  { type: 'chapter', props: { eyebrow: '01', text: 'Sell before you build' } },
  { type: 'stat', props: { text: '70%', sub: 'of free users never come back' } },
  { type: 'keyword', props: { text: 'Charge.' } },
  { type: 'quote', props: { text: 'Write the offer before the code.', sub: 'Rule one' } },
  { type: 'cta', props: { text: 'Comment LAB.', sub: 'For the full playbook', keyword: 'LAB' } },
  { type: 'card', props: { eyebrow: '02', title: 'Talk to the people who complain.', sub: 'They already told you what to build.' } },
];

const params = new URLSearchParams(location.search);
if (!params.has('render') && !params.has('preview')) {
  document.body.classList.add('cr-sample');
  const host = document.getElementById('cr-root');
  const theme = params.get('theme') || 'dark';
  const layouts = [[270, 480], [480, 270]];
  for (const [w, h] of layouts) {
    for (const s of SAMPLE) {
      const cell = el('div', 'cr-cell');
      cell.style.width = `${w}px`; cell.style.height = `${h}px`;
      const inner = el('div', 'cr-inner');
      cell.append(inner, el('span', null, `${s.type} ${w > h ? '16:9' : '9:16'}`));
      host.append(cell);
      const r = new Runtime(inner);
      const caps = s.type === 'card' ? [] : [{ id: 'c', t0: 0, t1: 99, words: 'here are three ways to get'.split(' ').map((x, k) => ({ text: x, t0: k * 0.3, t1: k * 0.3 + 0.3 })) }];
      r.load({ width: w, height: h, theme, overlays: [{ id: 'x', type: s.type, start: 0, end: 99, props: s.props }], captions: caps, captionStyle: 'word' });
      r.seek(3);
    }
  }
}
