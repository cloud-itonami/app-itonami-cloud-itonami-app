# Plugin submission checklist (A6)

OpenAI 側の提出手順（developers.openai.com/plugins/deploy/submission 準拠）。
初回提出は ZIP（`node scripts/package-plugin.mjs` で作成）。MCP server は
初回 ZIP に含めること（skills-only への後付けは不可）。

## 提出前

- [ ] ZIP が package guide 通り（`plugin.json`＋`mcp.json`＋`skills/`＋assets）
- [ ] ZIP に秘密情報を含めない（token・鍵・`.env` なし）
- [ ] 組織・プロジェクトの所有者と公開名義を決める（owner 決定）
- [ ] 個人/事業者 verification を済ませる（owner 決定）
- [ ] Apps Management Write の付与を確認する（owner 以外が上げる場合）

## MCP endpoint の扱い（未決定）

- 公開 directory の remote MCP は安定した public HTTPS endpoint が要る
  （With MCP）。bundled の stdio server は local 実行のため、desktop-only
  の提出経路（deploy/desktop-only）が該当する
- hosted `/mcp`（bearer/OAuth）を公開 endpoint にする案は未検討。
  itonami.cloud 側の公開可否と合わせて決める（owner 決定）

## 提出後の運用

- MCP server 側の変更は自動で拾われる（再提出不要）
- metadata・skills の変更は新しい ZIP が要る
- 自動チェックの findings は Copy issues で回収→修正→再 upload
