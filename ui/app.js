/* Router: #/ → projects, #/p/<id> → editor. */
import { h, clear } from './dom.js';
import { mountLibrary } from './library.js';
import { mountEditor } from './editor.js';

const root = document.getElementById('app');

function themeToggle() {
  const b = h('button.link', {
    style: { position: 'fixed', right: '18px', bottom: '14px', zIndex: 30 },
    onclick: () => {
      const dark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('cutroom-theme', dark ? 'dark' : 'light');
      b.textContent = dark ? 'Light' : 'Dark';
    },
  }, document.documentElement.classList.contains('dark') ? 'Light' : 'Dark');
  document.body.append(b);
}

async function route() {
  document.querySelectorAll('.sheet, .scrim, .menu').forEach(x => x.remove());
  const m = location.hash.match(/^#\/p\/([a-z0-9-]+)/);
  const view = h('div');
  clear(root).append(view);
  try {
    if (m) await mountEditor(view, m[1]);
    else await mountLibrary(view);
  } catch (e) {
    console.error(e);
    clear(view).append(h('div.waiting', h('a.link', { href: '#/' }, '← Projects'), h('h1.serif', 'Something went wrong.'), h('p.err', e.message)));
  }
}

window.addEventListener('hashchange', route);
themeToggle();
route();
