#!/usr/bin/env node
// Assemble the Codex plugin ZIP (Agent Plugins 1.0.0 + compat fallback).
// Usage: node scripts/package-plugin.mjs [--out dist/plugin.zip]
// Copies plugin.json, mcp.json, skills/, .codex-plugin/ and validates the
// set with the same rules as test/plugin-packaging.test.mjs. Needs the `zip`
// command on PATH.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv.includes('--out')
  ? resolve(root, process.argv[process.argv.indexOf('--out') + 1])
  : join(root, 'dist', 'plugin.zip');

const required = ['plugin.json', 'mcp.json', '.codex-plugin/plugin.json',
  'skills/itonami-app/SKILL.md', 'skills/setup/SKILL.md'];
for (const f of required) {
  if (!existsSync(join(root, f))) {
    console.error(`missing required package file: ${f}`);
    process.exit(1);
  }
}
// Portable manifest must stay the canonical identity: same name both sides.
const plugin = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
const compat = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
if (plugin.name !== compat.name) {
  console.error(`name mismatch: ${plugin.name} vs ${compat.name}`);
  process.exit(1);
}

const stage = join(root, 'dist', 'plugin-stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const f of ['plugin.json', 'mcp.json', 'skills', '.codex-plugin']) {
  cpSync(join(root, f), join(stage, f), { recursive: true });
}
mkdirSync(dirname(out), { recursive: true });

const zip = spawnSync('zip', ['-qr', out, '.'], { cwd: stage });
if (zip.status !== 0) {
  console.error(`zip failed (is zip on PATH?): ${zip.stderr}`);
  process.exit(1);
}
console.log(`packaged ${out}`);
