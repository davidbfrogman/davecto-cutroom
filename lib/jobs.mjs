/*
  Long-running work (ingest, render, B-roll downloads) as jobs with progress.

  A job is a list of weighted steps. Each step reports 0..1; the job turns that
  into one overall percentage and pushes events to whoever's listening (the
  UI over server-sent events, the CLI as a progress line). One job per
  project at a time; jobs can be cancelled.
*/
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

const jobs = new Map();
const byProject = new Map();

export class Job extends EventEmitter {
  constructor(projectId, type, steps) {
    super();
    this.id = `${type}-${randomBytes(3).toString('hex')}`;
    this.projectId = projectId;
    this.type = type;
    this.steps = steps;               // [{ id, label, weight }]
    this.status = 'running';
    this.step = null;
    this.progress = 0;
    this.message = '';
    this.log = [];
    this.result = null;
    this.error = null;
    this.startedAt = Date.now();
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this._done = 0;
    this.setMaxListeners(50);
  }

  get total() { return this.steps.reduce((n, s) => n + s.weight, 0) || 1; }

  /** Start a step; returns a progress callback for it. */
  begin(stepId, message = '') {
    if (this.step) this._done += this.steps.find(s => s.id === this.step)?.weight || 0;
    this.step = stepId;
    this.message = message || this.steps.find(s => s.id === stepId)?.label || stepId;
    this.note(this.message);
    this.tick(0);
    return p => this.tick(p);
  }

  tick(p) {
    if (this.signal.aborted) return;
    const w = this.steps.find(s => s.id === this.step)?.weight || 0;
    const next = Math.min(0.999, (this._done + w * Math.min(1, Math.max(0, p))) / this.total);
    if (next - this.progress < 0.002 && p < 1) return;
    this.progress = Math.max(this.progress, next);
    this.emit('update', this.snapshot());
  }

  note(line) {
    this.log.push(`${new Date().toISOString().slice(11, 19)}  ${line}`);
    if (this.log.length > 400) this.log.shift();
    this.emit('update', this.snapshot());
  }

  finish(result) {
    this.status = 'done';
    this.progress = 1;
    this.result = result ?? null;
    this.message = 'Done';
    this.endedAt = Date.now();
    this.note(`Done in ${((this.endedAt - this.startedAt) / 1000).toFixed(1)}s`);
    this.emit('end', this.snapshot());
  }

  fail(err) {
    this.status = err?.cancelled ? 'cancelled' : 'error';
    this.error = err?.cancelled ? 'Cancelled' : String(err?.message || err);
    this.endedAt = Date.now();
    this.note(this.status === 'cancelled' ? 'Cancelled' : `Error: ${this.error}`);
    this.emit('end', this.snapshot());
  }

  cancel() { this.controller.abort(); }

  snapshot() {
    return { id: this.id, projectId: this.projectId, type: this.type, status: this.status, step: this.step, steps: this.steps, progress: this.progress, message: this.message, error: this.error, result: this.result, log: this.log.slice(-60), startedAt: this.startedAt, endedAt: this.endedAt || null };
  }
}

/**
  Start a job for a project. fn(job) does the work and returns the result.
  Refuses if the project already has a running job.
*/
export function startJob(projectId, type, steps, fn) {
  const running = byProject.get(projectId);
  if (running && running.status === 'running') throw Object.assign(new Error(`Already running: ${running.type}`), { status: 409 });
  const job = new Job(projectId, type, steps);
  jobs.set(job.id, job);
  byProject.set(projectId, job);
  queueMicrotask(async () => {
    try { job.finish(await fn(job)); } catch (e) { if (!e.cancelled) console.error(e); job.fail(e); }
  });
  return job;
}

export const getJob = id => jobs.get(id);
export const projectJob = projectId => byProject.get(projectId);
