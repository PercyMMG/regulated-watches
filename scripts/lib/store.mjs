import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

/* ------------------------------------------------------------------ *
 * Minimal YAML frontmatter reader/writer.
 * Deliberately covers only the subset our schema uses: scalars and
 * string arrays. Decap CMS reads and writes the same subset, so the
 * two stay compatible.
 * ------------------------------------------------------------------ */

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^"[\s\S]*"$/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (/^'[\s\S]*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^\[.*\]$/.test(v)) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseScalar(s));
  }
  return v;
}

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const body = m[2] ?? '';
  const data = {};
  const lines = m[1].split(/\r?\n/);
  let key = null;
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(parseScalar(listItem[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      data[key] = kv[2].trim() === '' ? [] : parseScalar(kv[2]);
    }
  }
  return { data, body };
}

function emitScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(String(v));
}

export function stringifyFrontmatter(data, body = '') {
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
        continue;
      }
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${emitScalar(item)}`);
    } else {
      lines.push(`${k}: ${emitScalar(v)}`);
    }
  }
  lines.push('---', '');
  const trimmed = String(body || '').replace(/^\n+/, '').replace(/\s+$/, '');
  return lines.join('\n') + (trimmed ? trimmed + '\n' : '');
}

/* ------------------------------------------------------------------ *
 * File helpers
 * ------------------------------------------------------------------ */

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        return { _file: f, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) };
      } catch (err) {
        return { _file: f, _error: `Unreadable JSON: ${err.message}` };
      }
    });
}

export function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { data, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
      return { _file: f, ...data, long_description: body.trim() };
    });
}

export function writeJson(dir, name, obj) {
  ensureDir(dir);
  const { _file, ...clean } = obj;
  writeFileSync(join(dir, name), JSON.stringify(clean, null, 2) + '\n', 'utf8');
}

export function writeMarkdown(dir, name, data, body) {
  ensureDir(dir);
  const { _file, long_description, ...clean } = data;
  writeFileSync(join(dir, name), stringifyFrontmatter(clean, body ?? ''), 'utf8');
}

export function removeFile(dir, name) {
  const p = join(dir, name);
  if (existsSync(p)) rmSync(p);
}

const COMBINING_MARKS = /[̀-ͯ]/g;

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');
}

/**
 * Filename for a watch. `key` is the ASIN where there is one, and a catalogue
 * key (`cat-brand-ref`) where there is not: watches seeded from the bundled
 * catalogue have no ASIN until a human finds the listing.
 */
export const fileFor = (key, slug, ext) =>
  `${slug || slugify(key)}-${slugify(String(key))}.${ext}`;

/** ASIN, catalogue key, or id - whichever identifies this record. */
export const watchKey = (w) => w?.asin || w?.catalogue_key || w?.id || '';
