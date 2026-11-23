import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(root, 'mobile', 'dds.lock');
const lock = Object.fromEntries(
  readFileSync(lockPath, 'utf8')
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

// Canonical DDS source (AWAI-3015): the standalone
// kotoba-lang/jp-go-digital-design-system repository no longer resolves
// (404), so dds.lock must point at the kotoba monorepo, the only tracked
// copy whose bytes still match the pinned sha256. The stylesheet is
// fetched from the pinned revision at test time and hashed — if the
// upstream disappears or the content drifts, this fails instead of the
// build silently depending on a stale gitlibs cache.
const CANONICAL = {
  repository: 'kotoba-lang/kotoba',
  path: 'lib/kotoba.jpGoDigitalDesignSystem/resources/jp_go_dds/dds.css',
  sha256: '86ed3735a051817b93e8bdf281354a112675b3b45b96b61dacb6310cea818ce9',
};

test('mobile/dds.lock pins the canonical monorepo source and resolves upstream (AWAI-3015)', async () => {
  assert.equal(lock.repository, CANONICAL.repository);
  assert.equal(lock.path, CANONICAL.path);
  assert.equal(lock.sha256, CANONICAL.sha256);
  assert.match(lock.revision, /^[0-9a-f]{40}$/);

  const url = `https://raw.githubusercontent.com/${lock.repository}/${lock.revision}/${lock.path}`;
  const response = await fetch(url);
  assert.equal(response.status, 200, `pin does not resolve: GET ${url} -> ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(body).digest('hex');
  assert.equal(digest, lock.sha256, `upstream stylesheet drifted from dds.lock sha256 (got ${digest})`);
});
