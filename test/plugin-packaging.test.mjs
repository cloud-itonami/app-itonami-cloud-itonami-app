import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

test('Agent Plugins packaging is schema-shaped and path-complete (JUN-1064)', () => {
  const plugin = load('plugin.json');
  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.match(plugin.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  const allowed = new Set(['$schema', 'name', 'version', 'description', 'author',
    'homepage', 'repository', 'license', 'keywords', 'extensions']);
  for (const k of Object.keys(plugin)) assert.ok(allowed.has(k), `extra key ${k}`);

  const mcp = load('mcp.json');
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  for (const [name, srv] of Object.entries(mcp.mcpServers)) {
    assert.ok(['stdio', 'streamable-http', 'sse'].includes(srv.type), name);
    if (srv.type === 'stdio') {
      assert.ok(srv.command.length > 0);
      assert.ok(existsSync(join(root, srv.command)), `missing ${srv.command}`);
    }
  }

  const compat = load('.codex-plugin/plugin.json');
  assert.equal(compat.name, plugin.name);
  for (const manifest of [plugin, compat]) {
    const skill = manifest.extensions?.['com.openai']?.onboardingSkill;
    if (skill !== undefined) {
      assert.ok(skill.startsWith('./'));
      assert.ok(existsSync(join(root, skill)), `missing ${skill}`);
    }
  }
  assert.ok(existsSync(join(root, 'skills', 'itonami-app', 'SKILL.md')));
  assert.ok(existsSync(join(root, 'skills', 'setup', 'SKILL.md')));
});

test('package-plugin.mjs builds a submittable ZIP (JUN-1064 A6)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-pkg-'));
  const out = join(dir, 'plugin.zip');
  const built = spawnSync(process.execPath, [join(root, 'scripts', 'package-plugin.mjs'), '--out', out], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const list = spawnSync('zipinfo', ['-1', out], { encoding: 'utf8' });
  assert.equal(list.status, 0, 'zipinfo failed');
  const names = new Set(list.stdout.split('\n').filter(Boolean));
  for (const f of ['plugin.json', 'mcp.json', '.codex-plugin/plugin.json',
    'skills/itonami-app/SKILL.md', 'skills/setup/SKILL.md']) {
    assert.ok(names.has(f), `missing ${f}`);
  }
  for (const n of names) {
    assert.ok(!/(^|\/)\.(env|token|secret)/.test(n), `secret-like entry ${n}`);
  }
});
