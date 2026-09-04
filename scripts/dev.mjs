#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * One command, one port, both halves of the site.
 *
 * Starts the Astro dev server and the curation dashboard together. Astro's
 * Vite config proxies /curate through to the dashboard, so the public site and
 * the admin live at the same origin and there is nothing to flick between.
 *
 *   http://localhost:4321          the site
 *   http://localhost:4321/curate   the dashboard
 *
 * The dashboard is still a standalone server (`npm run curate` on its own port
 * works exactly as before). Keeping it separate means the admin is not built
 * into the site and cannot be deployed by accident - it writes to your working
 * tree, so it must never leave your machine.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// GitHub Pages serves a project repo from a subdirectory, so `base` is set and
// the dev server mirrors it. Bare localhost:4321 404s; print what actually works.
const BASE = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8')).basePath || '';
const isWin = process.platform === 'win32';

const children = [];

function start(name, command, args, colour) {
  const child = spawn(command, args, {
    cwd: ROOT,
    shell: isWin, // npm/npx are .cmd shims on Windows
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  const tag = `\x1b[${colour}m${name.padEnd(7)}\x1b[0m`;
  const relay = (stream) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) console.log(`${tag} ${line}`);
    });
  };
  relay(child.stdout);
  relay(child.stderr);

  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`${tag} exited with code ${code}. Stopping the other process too.`);
    stopAll(code ?? 1);
  });

  children.push(child);
  return child;
}

let shuttingDown = false;
function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    try {
      // On Windows a shell-spawned child needs the tree killing, or the dev
      // server keeps the port and the next run fails with EADDRINUSE.
      if (isWin) spawn('taskkill', ['/pid', String(c.pid), '/f', '/t'], { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 400);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

console.log('');
console.log('  Regulated — site and dashboard together');
console.log(`  ${'-'.repeat(52)}`);
console.log(`  http://localhost:4321${BASE}   the site`);
console.log('  http://localhost:4321/curate' + ' '.repeat(Math.max(1, BASE.length)) + '  the dashboard');
console.log('');
console.log('  Ctrl+C stops both.');
console.log('');

start('curate', 'node', [join(HERE, 'curate.mjs')], '33');
start('site', 'npx', ['astro', 'dev'], '36');
