import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = resolve(root, 'bin', 'itonami-mcp');
const stubs = resolve(root, 'test', 'nbb-stubs');
const nbb = process.env.NBB || 'nbb';

const rpc = (id, method, params) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

// The host is driven through a symlink in a bare temp dir: nbb discovers
// project config from the script path, and the app root nbb.edn currently
// names git deps whose upstreams are gone (pre-existing breakage). The
// symlink keeps the executed bytes identical to bin/itonami-mcp.
function drive(requests) {
  const dir = mkdtempSync(join(tmpdir(), 'itonami-mcp-ui-'));
  const link = join(dir, 'host');
  symlinkSync(host, link);
  const child = spawnSync(nbb, ['--classpath', stubs, link], {
    input: requests.join('\n') + '\n',
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(child.status, 0, `host exited ${child.status}: ${child.stderr}`);
  return child.stdout.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

test('nbb host carries the Codex entrypoint surface (JUN-1062)', () => {
  const [init, list, call, read, missing] = drive([
    rpc(1, 'initialize', { protocolVersion: '2025-11-25' }),
    rpc(2, 'tools/list'),
    rpc(3, 'tools/call', { name: 'itonami_open', arguments: {} }),
    rpc(4, 'resources/read', { uri: 'ui://cloud-itonami-app/home' }),
    rpc(5, 'resources/read', { uri: 'ui://no-such-app' }),
  ]);

  assert.ok(typeof init.result.capabilities.experimental['openai/ui'] === 'object');

  const tools = Object.fromEntries(list.result.tools.map((t) => [t.name, t]));
  assert.deepEqual(tools.itonami_open._meta, {
    ui: { resourceUri: 'ui://cloud-itonami-app/home' },
    'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] },
  });
  assert.equal(tools.fleet_search._meta, undefined);

  const opened = JSON.parse(call.result.content[0].text);
  assert.equal(opened.app, 'cloud-itonami-app');
  assert.equal(opened.resourceUri, 'ui://cloud-itonami-app/home');
  assert.equal(call.result.isError, undefined);

  const [item] = read.result.contents;
  assert.equal(item.uri, 'ui://cloud-itonami-app/home');
  assert.equal(item.mimeType, 'text/html;profile=mcp-app');
  assert.ok(item.text.includes('http://127.0.0.1:1338'));
  assert.deepEqual(item._meta['openai/ui'].availableDisplayModes, ['inline', 'fullscreen']);

  assert.equal(missing.error.code, -32601);
});
