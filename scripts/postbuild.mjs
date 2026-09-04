#!/usr/bin/env node
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './lib/config.mjs';

/**
 * Runs after `npm run build` (npm's `postbuild` hook).
 *
 * Decap's login page cannot work on GitHub Pages: authentication needs the
 * OAuth proxy in functions/, and GitHub Pages runs no server code. Publishing a
 * login form that can never succeed is confusing to anyone who finds it and
 * invites probing for no benefit.
 *
 * It stays in public/ so `npm run dev` still serves it locally alongside
 * `npm run cms`. Delete this hook if the site moves to a host that can run the
 * functions, and /admin becomes real again.
 */
const admin = join(paths.root, 'dist', 'admin');
if (existsSync(admin)) {
  rmSync(admin, { recursive: true, force: true });
  if (process.env.VERBOSE) console.log('  removed dist/admin (cannot authenticate on GitHub Pages)');
}
