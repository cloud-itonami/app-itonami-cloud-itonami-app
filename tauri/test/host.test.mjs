import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clientEndpointAllowsRequest, clientRuntimeProblems } from "../vendor/kotoba-client-runtime.js";
import { INGRESS_ORIGIN, buildDescriptor, requestedCapabilities } from "../src/descriptor.mjs";

const here = fileURLToPath(new URL("../", import.meta.url));
const tables = JSON.parse(readFileSync(path.join(here, "../mobile/data/command-tables.json"), "utf8"));
const descriptor = buildDescriptor({ commandTables: tables });
const op = (name) => descriptor.operations.find((o) => o.operation === name);
const allows = (name, url, method = "GET") => clientEndpointAllowsRequest(op(name).endpoint, url, method);

test("descriptor is valid for the shared runtime and every operation is each-operation consent", () => {
  assert.deepEqual(clientRuntimeProblems(descriptor, requestedCapabilities(descriptor), ["https://tauri.localhost"]), []);
  assert.ok(descriptor.operations.every((o) => o.consent === "each-operation"));
  assert.ok(descriptor.operations.every((o) => o.endpoint.origin !== "https://tauri.localhost"));
});

test("fleet reads admit only the two declared routes and query names", () => {
  const base = descriptor.operations[0].endpoint.origin;
  assert.ok(allows("search", `${base}/api/fleet/search?limit=32&text=a&role=b`));
  assert.ok(!allows("search", `${base}/api/fleet/search?evil=1`));
  assert.ok(!allows("search", `${base}/api/fleet/search`, "POST"));
  assert.ok(allows("facets", `${base}/api/fleet/facets?field=role`));
  assert.ok(!allows("facets", `${base}/api/fleet/facets?field=other`));
  assert.ok(!allows("search", "https://evil.example/api/fleet/search"));
});

test("ingress reads cover the pinned GET table; writes are exactly the three offered templates", () => {
  const gets = new Set(tables.routes.filter((r) => r.method === "GET").map((r) => r.template));
  assert.equal(op("read").endpoint.routes.length, gets.size);
  assert.ok(allows("read", `${INGRESS_ORIGIN}/api/agent-session`));
  assert.ok(allows("read", `${INGRESS_ORIGIN}/api/business/abc/canvas`));
  assert.ok(!allows("read", `${INGRESS_ORIGIN}/api/agent-session?x=1`));
  assert.ok(!allows("read", `${INGRESS_ORIGIN}/api/agent-session`, "POST"));
  const write = "conversation-message";
  assert.ok(allows(write, `${INGRESS_ORIGIN}/api/agent-bots/bot1/messages`, "POST"));
  assert.ok(allows(write, `${INGRESS_ORIGIN}/p/main/api/sessions`, "POST"));
  assert.ok(allows(write, `${INGRESS_ORIGIN}/p/main/api/sessions/s1/messages`, "POST"));
  assert.ok(!allows(write, `${INGRESS_ORIGIN}/api/workers`, "POST"));
  assert.ok(!allows(write, `${INGRESS_ORIGIN}/api/agent-bots/bot1/messages`, "DELETE"));
});

test("build derives CSP from declared origins, injects the host first, and fails closed without a built bundle", () => {
  const src = mkdtempSync(path.join(tmpdir(), "cia-dist-"));
  const out = path.join(src, "out");
  mkdirSync(path.join(src, "in/js"), { recursive: true });
  writeFileSync(path.join(src, "in/dds.css"), "");
  writeFileSync(path.join(src, "in/js/main.js"), "");
  writeFileSync(path.join(src, "in/index.html"), '<html><head><style>a{}</style><link rel="stylesheet" href="dds.css"></head><body><script type="module" src="js/main.js"></script></body></html>');
  const env = { ...process.env, MOBILE_DIST: path.join(src, "in"), TAURI_DIST: out };
  execFileSync(process.execPath, [path.join(here, "scripts/build.mjs")], { env });
  const html = readFileSync(path.join(out, "index.html"), "utf8");
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src 'self' https:\/\/agent\.itonami\.cloud https:\/\/cloud-itonami-app-edge\.[^ ]+ ipc: http:\/\/ipc\.localhost/);
  assert.match(csp, /style-src 'self' 'sha256-/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.ok(html.indexOf("host.js") < html.indexOf("js/main.js"));
  assert.ok(html.indexOf("runtime-consent.css") < html.indexOf("dds.css"));
  const missing = { ...env, MOBILE_DIST: path.join(src, "nope") };
  assert.throws(() => execFileSync(process.execPath, [path.join(here, "scripts/build.mjs")], { env: missing, stdio: "pipe" }), /missing/);
});

test("host source routes cross-origin fetches through the broker and has no raw network fallback", () => {
  const host = readFileSync(path.join(here, "src/host.js"), "utf8");
  assert.match(host, /broker\.invoke/);
  assert.match(host, /宣言されていない/);
  assert.equal((host.match(/appFetch\(/g) ?? []).length, 1);
  assert.doesNotMatch(host, /XMLHttpRequest|WebSocket|sendBeacon|innerHTML/);
});
