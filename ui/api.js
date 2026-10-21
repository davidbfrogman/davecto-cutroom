/* The app server's JSON API. */

async function req(method, url, body, raw) {
  const opt = { method, headers: {} };
  if (raw) { opt.body = raw; }
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
  return data;
}

export const api = {
  health: () => req('GET', '/api/health'),
  projects: () => req('GET', '/api/projects'),
  create: b => req('POST', '/api/projects', b),
  upload: (file, q) => req('POST', `/api/projects/upload?${new URLSearchParams({ name: file.name, ...q })}`, undefined, file),
  project: id => req('GET', `/api/projects/${id}`),
  analysis: id => req('GET', `/api/projects/${id}/analysis`),
  save: (id, b) => req('PUT', `/api/projects/${id}`, b),
  remove: id => req('DELETE', `/api/projects/${id}`),
  plan: (id, settings) => req('POST', `/api/projects/${id}/plan`, { settings }),
  ingest: (id, b) => req('POST', `/api/projects/${id}/ingest`, b),
  render: (id, b) => req('POST', `/api/projects/${id}/render`, b),
  luts: () => req('GET', '/api/luts'),
  library: id => req('GET', `/api/library?project=${id || ''}`),
  broll: (id, b) => req('POST', `/api/projects/${id}/broll`, b),
  brollUpload: (id, file) => req('POST', `/api/projects/${id}/broll/upload?name=${encodeURIComponent(file.name)}`, undefined, file),
  cancel: jobId => req('POST', `/api/jobs/${jobId}/cancel`),
  reveal: path => req('POST', '/api/reveal', { path }),
  fonts: () => req('GET', '/api/fonts'),
  saveBrand: brand => req('PUT', '/api/brand', brand),
  /** Save with the rev you loaded. Returns { ok, status, project, rev, error } (409 = someone else saved first). */
  saveRev: async (id, b) => {
    const r = await fetch(`/api/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ...d };
  },
  addNote: (id, b) => req('POST', `/api/projects/${id}/threads`, b),
  reply: (id, tid, b) => req('POST', `/api/projects/${id}/threads/${tid}/messages`, b),
  setThread: (id, tid, b) => req('PATCH', `/api/projects/${id}/threads/${tid}`, b),
  deleteThread: (id, tid) => req('DELETE', `/api/projects/${id}/threads/${tid}`),
  sendNotes: id => req('POST', `/api/projects/${id}/send`),
  motions: id => req('GET', `/api/projects/${id}/motions`),
  renderMotion: (id, b) => req('POST', `/api/projects/${id}/motions/render`, b),
};

/** Follow a job over server-sent events. onUpdate(snapshot) until it ends; resolves with the last snapshot. */
export function follow(jobId, onUpdate) {
  return new Promise(resolve => {
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    let last = null;
    es.onmessage = e => {
      last = JSON.parse(e.data);
      onUpdate?.(last);
      if (last.status !== 'running') { es.close(); resolve(last); }
    };
    es.onerror = () => { es.close(); resolve(last || { status: 'error', error: 'Lost connection to the server' }); };
  });
}

export const frameUrl = (id, q) => `/api/projects/${id}/frame?${new URLSearchParams(q)}`;
export const mediaUrl = path => `/api/media?path=${encodeURIComponent(path)}`;
