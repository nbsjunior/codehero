# MCP CodeHero — conectar nas ferramentas de IA

Guia completo (passo a passo):  
**[docs/wiki/Conectar-MCP-CodeHero.md](../../docs/wiki/Conectar-MCP-CodeHero.md)**

| Ferramenta | Arquivo / lugar | Exemplo |
|---|---|---|
| **Cursor** | `.cursor/mcp.json` | [cursor.example.json](./cursor.example.json) |
| **Claude Desktop** | `claude_desktop_config.json` | [claude_desktop.example.json](./claude_desktop.example.json) |
| **GitHub Copilot** | `.vscode/mcp.json` | [github_copilot.example.json](./github_copilot.example.json) |
| **Devin** | Settings → MCP (STDIO) ou `.devin/mcp_config.json` | [devin.example.json](./devin.example.json) |

## Fluxo rápido (todas)

1. Portal CodeHero → **Projetos → Integração MCP** → copiar JSON (com token).
2. Colar no arquivo / UI da ferramenta (tabela acima).
3. Reiniciar agente / MCP.
4. Testar: *“Chame get_generation_context com as regras CodeHero.”*

**Requisito:** Node.js ≥ 20 · pacote npm [`codehero-mcp`](https://www.npmjs.com/package/codehero-mcp)

Docs no produto: https://codehero.web.app/docs/#mcp
