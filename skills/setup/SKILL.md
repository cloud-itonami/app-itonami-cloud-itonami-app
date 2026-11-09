---
name: itonami-setup
description: Set up the Itonami plugin after installation. Use when the user installs the plugin or asks how to connect the Itonami app.
---

# Itonami Setup

You just installed the Itonami plugin. Two minutes to a first answer.

## 1. Start the app (optional, for the sidebar)

The MCP server works without it, but the sidebar entrypoint opens the
running app. Start it with `bin/cloud-itonami-server` (default port 1338,
`CLOUD_ITONAMI_PORT` overrides), then open `http://127.0.0.1:1338`.

## 2. Search the actor catalog

Call `fleet_search` with what you need. Every field is optional.

```
fleet_search {"text": "invoice triage", "callable": true, "limit": 5}
```

Hits carry `repo`, `id`, `name`, `domain`, and execution info. `fleet_call`
is not on the bundled server; run the named repo's entrypoint yourself.

## 3. Open the app surface

Call `itonami_open` with `{}`. It answers the app identity, the UI
resource, and the local URL. No session or arguments needed.

Done. Ask anything, or open the sidebar app to keep working beside the chat.
