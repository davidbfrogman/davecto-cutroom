// "Hold your horses": a project that's still being set up (the light preview copy of the video being made,
// or a new project still transcribing / finding faces) shows a screen with each step's progress instead of
// an editor that can't play yet. When everything's ready the page reloads into the editor.
import { $, esc, state } from './state.js';

const pct = f => `${Math.round((f || 0) * 100)}%`;
function row(title, sub, frac, steps = false) {         // steps: the job moves in steps (whisper has no %), so animate the bar
  return `<div class="pr-row"><div class="pr-t"><b>${esc(title)}</b><span>${esc(sub)}</span></div>
    <div class="pr-bar ${steps ? 'steps' : ''}"><i style="width:${Math.max(4, (frac || 0) * 100)}%"></i></div></div>`;
}
function paint(el, p) {
  const rows = [];
  for (const j of p.jobs) {
    if (j.state === 'queued') { rows.push(row(j.label, 'waiting for another job to finish', 0)); continue; }
    const step = j.bar?.label || 'starting';
    rows.push(row(step[0].toUpperCase() + step.slice(1), j.bar?.note || '', j.bar?.frac, true));
  }
  if (!p.light.ready) rows.push(p.light.error ? row('Preview copy of the video', `failed: ${p.light.error}`, 0)
    : row('Preview copy of the video', `${pct(p.light.frac)} · a light copy the editor plays, made once`, p.light.frac));
  el.innerHTML = `<div class="pr-card">
    <h2>Hold your horses</h2>
    <p class="pr-sub"><b>${esc(state.name || '')}</b> is still being set up. The editor opens by itself when it's done.</p>
    ${p.failed ? `<p class="pr-err">${esc(p.failed.label)} failed: ${esc(p.failed.error || '')}</p>` : ''}
    ${rows.join('') || row('Opening the editor', '', 1)}
    <div class="pr-foot"><a class="btn sm" href="/">← Projects</a><span>You can leave this page; it keeps going.</span></div></div>`;
}

/** Resolves true when the editor can start now; otherwise shows the screen and reloads the page once it's ready
    (the editor never starts half-loaded underneath). */
export async function initPrep() {
  const get = () => fetch('api/prep').then(r => (r.ok ? r.json() : null)).catch(() => null);
  let p = await get();
  if (!p || p.ready) return true;                      // ready (or not served by the Studio): start the editor
  const el = document.createElement('div'); el.id = 'prep'; document.body.append(el);
  for (; ;) {
    paint(el, p);
    if (p.ready) { setTimeout(() => location.reload(), 600); return new Promise(() => {}); }
    if (p.failed && !p.jobs.length && (p.light.ready || p.light.error)) return new Promise(() => {});   // nothing left running: leave the message up
    await new Promise(r => setTimeout(r, 700));
    p = (await get()) || p;
  }
}
