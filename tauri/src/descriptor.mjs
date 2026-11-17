// Builds the kotoba.app.client-runtime.v1 descriptor for the Tauri host from
// the bundle's own pinned command table. Pure: no I/O, so tests can call it.
export const INGRESS_ORIGIN = "https://agent.itonami.cloud";
// Same value as the bundle's MOBILE_API_BASE default (mobile/scripts/build-bundle.mjs).
export const DEFAULT_API_BASE = "https://cloud-itonami-app-edge.04-feasts-minded.workers.dev";
// The only writes the command pane offers (mobile/src/main.mjs resolveTerminalUrl).
export const OFFERED_WRITES = [
  "/api/agent-bots/{id}/messages",
  "/p/{profile}/api/sessions",
  "/p/{profile}/api/sessions/{session}/messages",
];

// {agent-bot} -> :agent_bot (the runtime allows letters, digits and _ only).
export const toRoutePath = (template) => template.replace(/\{([^}]+)\}/gu, (_, name) => `:${name.replace(/[^A-Za-z0-9_]/gu, "_")}`);

export function buildDescriptor({ commandTables, apiBase = DEFAULT_API_BASE }) {
  const apiOrigin = new URL(apiBase).origin;
  const reads = [...new Set(commandTables.routes.filter((r) => r.method === "GET").map((r) => r.template))].sort();
  const get = (path) => ({ method: "GET", path: toRoutePath(path), "query-params": [] });
  return {
    schema: "kotoba.app.client-runtime.v1",
    target: "browser",
    profile: "trusted-page-v1",
    entry: "index.html",
    "local-state": { adapter: "localstorage", schema: "cloud.itonami.mobile.pairing.v1", version: 1 },
    workers: [],
    operations: [
      { capability: "itonami/fleet-read", service: "itonami-fleet-directory", operation: "search", consent: "each-operation",
        "data-categories": ["fleet-search-text"],
        endpoint: { origin: apiOrigin, routes: [{ method: "GET", path: "/api/fleet/search", "query-params": ["limit", "text", "role"] }] } },
      { capability: "itonami/fleet-read", service: "itonami-fleet-directory", operation: "facets", consent: "each-operation",
        "data-categories": ["fleet-role-filter"],
        endpoint: { origin: apiOrigin, routes: [{ method: "GET", path: "/api/fleet/facets", "query-params": ["field"], "query-values": { field: "role" } }] } },
      { capability: "itonami/agent-read", service: "itonami-agent-ingress", operation: "read", consent: "each-operation",
        "data-categories": ["pairing-token", "command-path"],
        endpoint: { origin: INGRESS_ORIGIN, routes: reads.map(get) } },
      { capability: "itonami/agent-write", service: "itonami-agent-ingress", operation: "conversation-message", consent: "each-operation",
        "data-categories": ["pairing-token", "conversation-message"],
        endpoint: { origin: INGRESS_ORIGIN, routes: OFFERED_WRITES.map((p) => ({ method: "POST", path: toRoutePath(p), "query-params": [] })) } },
    ],
  };
}

export const requestedCapabilities = (descriptor) => [...new Set(descriptor.operations.map((o) => o.capability))];
export const selectorOf = (op) => [op.capability, op.service, op.operation];
