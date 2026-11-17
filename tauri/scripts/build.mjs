// Package the already-built mobile/dist as the Tauri frontend: copy it, add the
// pinned consent broker, the host adapter and the descriptor, and derive the
// CSP from the declared service origins. It never builds the Amu guest itself.
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildDescriptor, requestedCapabilities } from "../src/descriptor.mjs";
import { clientRuntimeConnectSrc, clientRuntimeProblems } from "../vendor/kotoba-client-runtime.js";

const here = fileURLToPath(new URL("../", import.meta.url));
const source = path.resolve(process.env.MOBILE_DIST ?? path.join(here, "../mobile/dist"));
const out = path.resolve(process.env.TAURI_DIST ?? path.join(here, "dist"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { console.error(`tauri build: ${message}`); process.exit(1); };

const pins = JSON.parse(await readFile(path.join(here, "vendor/PINS.json"), "utf8"));
for (const [name, digest] of Object.entries(pins.files)) {
  if (sha(await readFile(path.join(here, "vendor", name))) !== digest) fail(`canonical runtime pin drift: ${name}`);
}
for (const needed of ["index.html", "js/main.js", "dds.css"]) {
  try { await stat(path.join(source, needed)); }
  catch { fail(`${path.join(source, needed)} is missing. Build the bundle first: cd mobile && npm run build (needs the pinned Amu, engine and DDS checkouts; see mobile/README.md).`); }
}

const apiBase = process.env.MOBILE_API_BASE ?? undefined;
const tables = JSON.parse(await readFile(path.join(here, "../mobile/data/command-tables.json"), "utf8"));
const descriptor = buildDescriptor({ commandTables: tables, ...(apiBase ? { apiBase } : {}) });
const capabilities = requestedCapabilities(descriptor);
const problems = clientRuntimeProblems(descriptor, capabilities, ["https://tauri.localhost"]);
if (problems.length) fail(`descriptor is invalid: ${JSON.stringify(problems)}`);
const connect = clientRuntimeConnectSrc(descriptor, capabilities, [], ["https://tauri.localhost"]);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(source, out, { recursive: true });
await cp(path.join(here, "vendor/kotoba-client-runtime.js"), path.join(out, "runtime.js"));
await cp(path.join(here, "vendor/kotoba-client-consent.css"), path.join(out, "runtime-consent.css"));
await cp(path.join(here, "src/host.js"), path.join(out, "host.js"));
await writeFile(path.join(out, "descriptor.json"), JSON.stringify(descriptor, null, 2) + "\n");
await writeFile(path.join(out, "descriptor.js"), `export default ${JSON.stringify(descriptor)};\n`);

let html = await readFile(path.join(out, "index.html"), "utf8");
if (/<meta[^>]+http-equiv=["']Content-Security-Policy/iu.test(html)) fail("the bundle already carries a CSP; refusing to merge policies");
const mainScript = '<script type="module" src="js/main.js"></script>';
if (!html.includes(mainScript)) fail("the bundle entry script tag was not found");
const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)].map((m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
const csp = ["default-src 'none'", "script-src 'self'", `style-src 'self' ${styles.join(" ")}`.trim(), "img-src 'self' data:",
  "font-src 'self'", `${connect.replace("connect-src ", "connect-src 'self' ")} ipc: http://ipc.localhost`, "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"].join("; ");
html = html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`)
  .replace('<link rel="stylesheet" href="dds.css">', '<link rel="stylesheet" href="runtime-consent.css"><link rel="stylesheet" href="dds.css">')
  .replace(mainScript, `<script type="module" src="host.js"></script>${mainScript}`);
await writeFile(path.join(out, "index.html"), html);

const files = {};
const walk = async (dir) => { for (const entry of await readdir(path.join(out, dir), { withFileTypes: true })) {
  const rel = path.posix.join(dir, entry.name);
  if (entry.isDirectory()) await walk(rel);
  else if (rel !== "release.json") files[rel] = sha(await readFile(path.join(out, rel)));
} };
await walk("");
await writeFile(path.join(out, "release.json"), JSON.stringify({ schema: "awai.app.artifact.v1", id: "cloud.itonami.app", tauri: "3.0.0-alpha.6", runtimePins: pins, csp, files }, null, 2) + "\n");
console.log(`Cloud Itonami Tauri frontend: ${Object.keys(files).length} files; ${connect}`);
