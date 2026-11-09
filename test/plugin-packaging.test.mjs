import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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
