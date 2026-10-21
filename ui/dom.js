/* Tiny DOM helpers. h('div.cls#id', { onclick, style, ... }, ...children) */

export function h(sel, props, ...kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { kids.unshift(props); props = {}; }
  const [, tag = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(sel);
  const el = document.createElement(tag || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2];
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && !k.startsWith('aria') && k !== 'list' && k !== 'form') {
      try { el[k] = v; } catch { el.setAttribute(k, v); }   // read-only props (textarea.type) become attributes
    }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = (s, root = document) => root.querySelector(s);

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  /** Run now if a call is waiting; otherwise do nothing. */
  d.flush = (...a) => { if (t === null) return; clearTimeout(t); t = null; return fn(...a); };
  d.pending = () => t !== null;
  return d;
}

export function toast(msg, ms = 2400) {
  const t = h('div.toast', msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

/** A small popup menu at an element. items: [{ label, meta, pressed, onClick } | 'hr'] */
export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach(m => m.remove());
  const r = anchor.getBoundingClientRect();
  const m = h('div.menu', { role: 'menu' }, items.map(it => it === 'hr' ? h('hr') : h('button', {
    type: 'button', 'aria-pressed': it.pressed ? 'true' : 'false',
    onclick: e => { e.stopPropagation(); m.remove(); it.onClick(); },
  }, h('span', it.label), it.meta ? h('span.meta', it.meta) : null)));
  document.body.append(m);
  const mh = m.offsetHeight, mw = m.offsetWidth;
  m.style.left = `${Math.min(window.innerWidth - mw - 8, r.left)}px`;
  m.style.top = `${r.bottom + 4 + mh > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4}px`;
  const close = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true));
  return m;
}

export const uid = p => `${p}${Math.random().toString(36).slice(2, 8)}`;
