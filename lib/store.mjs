import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateStructure, sectionIds } from './organiser.mjs';

export function validateGuide(guide) {
  if (!guide || typeof guide.original_prompt !== 'string' || !guide.original_prompt.trim() || typeof guide.product !== 'string' || !guide.product.trim()) throw new Error('Guide requires a product and original prompt.');
  const stripLinks = value => Array.isArray(value) ? value.map(stripLinks) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'source_links').map(([key, child]) => [key, stripLinks(child)])) : value;
  validateStructure(stripLinks(guide.content));
  if (JSON.stringify(guide.content.sections.map(s => s.id)) !== JSON.stringify(sectionIds)) throw new Error('Guide requires all eight ordered sections.');
  if (!Array.isArray(guide.sources) || new Set(guide.sources.map(s => s.id)).size !== guide.sources.length) throw new Error('Invalid source catalog.');
  const ids = new Set(guide.sources.map(s => s.id));
  function check(value) {
    if (!value || typeof value !== 'object') return;
    if (value.source_ids?.some(id => !ids.has(id))) throw new Error('Unknown source reference.');
    if (value.rows?.some(row => row.cells.length !== value.columns.length)) throw new Error('Invalid table width.');
    Object.values(value).forEach(check);
  }
  check(guide.content);
  return guide;
}

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS guides (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, product TEXT NOT NULL, title TEXT NOT NULL,
      original_prompt TEXT NOT NULL, content_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, prompt TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
      guide_id TEXT REFERENCES guides(id), clarification TEXT, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
  const jobColumns = new Set(db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name));
  for (const column of ['progress_message', 'heartbeat_at', 'stage_started_at']) {
    if (!jobColumns.has(column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} TEXT`);
  }
  return {
    close: () => db.close(),
    insertGuide(guide, slug) {
      validateGuide(guide);
      const id = randomUUID();
      const base = guide.product.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guide';
      slug ||= `${base}-${id.slice(0, 8)}`;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 150) throw new Error('Invalid guide slug.');
      const createdAt = new Date().toISOString();
      db.prepare('INSERT INTO guides VALUES (?,?,?,?,?,?,?,?)').run(id, slug, guide.product, guide.content.title, guide.original_prompt,
        JSON.stringify(guide), guide.verification?.status || 'needs_review', createdAt);
      return { id, slug, created_at: createdAt };
    },
    getGuide(slug) {
      const row = db.prepare('SELECT * FROM guides WHERE slug = ?').get(slug);
      return row ? { ...row, guide: JSON.parse(row.content_json) } : null;
    },
    listGuides() {
      return db.prepare('SELECT id, slug, product, title, original_prompt, created_at FROM guides ORDER BY created_at DESC').all();
    },
    createJob(prompt, id = randomUUID()) {
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Job prompt is required.');
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid job ID.');
      const now = new Date().toISOString();
      db.prepare('INSERT INTO jobs (id,prompt,status,stage,guide_id,clarification,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, prompt, 'queued', 'input_analyser', null, null, null, now, now);
      return id;
    },
    getJob(id) { return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) || null; },
    updateJobProgress(id, message) {
      const now = new Date().toISOString();
      db.prepare("UPDATE jobs SET progress_message=?, heartbeat_at=? WHERE id=? AND status='running'").run(message, now, id);
    },
    getGuideById(id) {
      const row = db.prepare('SELECT * FROM guides WHERE id = ?').get(id);
      return row ? { ...row, guide: JSON.parse(row.content_json) } : null;
    },
    recentJobCount(since) { return db.prepare('SELECT count(*) AS count FROM jobs WHERE created_at >= ?').get(since).count; },
    interruptPendingJobs() {
      db.prepare("UPDATE jobs SET status='failed', error='Generation was interrupted by a server restart. Submit again to start a new run.', updated_at=? WHERE status IN ('queued','running')")
        .run(new Date().toISOString());
    },
    completeJob(id, guide) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const saved = this.insertGuide(guide);
        this.updateJob(id, { status: 'completed', stage: 'completed', guide_id: saved.id });
        db.exec('COMMIT');
        return saved;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    updateJob(id, { status, stage, guide_id = null, clarification = null, error = null }) {
      if (!['queued', 'running', 'completed', 'failed', 'needs_clarification'].includes(status)) throw new Error('Invalid job status.');
      if (!['input_analyser', 'web_search', 'validator', 'organiser', 'completed'].includes(stage)) throw new Error('Invalid job stage.');
      if (status === 'completed' && !guide_id) throw new Error('Completed jobs need a guide.');
      if (status === 'needs_clarification' && !clarification) throw new Error('Clarification question is required.');
      const now = new Date().toISOString();
      const result = db.prepare('UPDATE jobs SET stage_started_at=CASE WHEN stage<>? OR stage_started_at IS NULL THEN ? ELSE stage_started_at END, status=?, stage=?, guide_id=?, clarification=?, error=?, updated_at=? WHERE id=?')
        .run(stage, now, status, stage, guide_id, clarification, error, now, id);
      if (!result.changes) throw new Error('Job not found.');
    },
  };
}
