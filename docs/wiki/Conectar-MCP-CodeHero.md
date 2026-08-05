# Conectar o CodeHero MCP — passo a passo

Guia para ligar o **CodeHero** em **Cursor**, **Claude Desktop**, **GitHub Copilot** e **Devin**.

Pacote npm: [`codehero-mcp`](https://www.npmjs.com/package/codehero-mcp) · API: `https://codehero.web.app/api`

---

## 0. Pré-requisitos (todas as ferramentas)

1. Conta no [portal CodeHero](https://codehero.web.app) com um **projeto** e **repositório** provisionados.
2. **Node.js ≥ 20** instalado (para `npx`).
3. No portal: **Projetos → Integração MCP**
   - Selecione o projeto e o repositório
   - Copie o **JSON** gerado (já traz `HERO_TOKEN`, org, project, repo)
   - Opcional: copie também a **regra do agente** e o **prompt** de chat

Variáveis que o JSON preenche:

| Variável | Função |
|---|---|
| `HERO_CORE_URL` | `https://codehero.web.app/api` |
| `HERO_TOKEN` | Token de ingestão do repositório |
| `HERO_ORG_ID` / `HERO_PROJECT_ID` / `HERO_REPO_ID` | Alvo das tools |

> Não versione o token em repositório público. Se vazar: **Rotacionar token** no workspace.

---

## 1. Cursor

### Passos

1. Abra o repositório do **seu produto** (não precisa do monorepo CodeHero).
2. Crie o arquivo `.cursor/mcp.json` na raiz:

```json
{
  "mcpServers": {
    "codehero": {
      "command": "npx",
      "args": ["-y", "codehero-mcp@latest"],
      "env": {
        "HERO_CORE_URL": "https://codehero.web.app/api",
        "HERO_TOKEN": "<cole-do-portal>",
        "HERO_ORG_ID": "<orgId>",
        "HERO_PROJECT_ID": "<projectId>",
        "HERO_REPO_ID": "<repoId>"
      }
    }
  }
}
```

3. (Recomendado) Crie `.cursor/rules/codehero-mcp.mdc` com a regra copiada do portal (“antes de gerar código, chame `get_generation_context`…”).
4. Abra **Cursor Settings → MCP** e confirme que `codehero` aparece (verde / Connected). Se precisar: **Refresh**.
5. No chat Agent, peça:

> Use o MCP CodeHero. Chame `get_generation_context` com as regras de avaliação e aplique no contexto.

6. Teste o loop de correção:

> Liste issues CRITICAL com `get_issues`, pegue o SDD da primeira com `get_sdd_spec`, proponha o patch e confirme com `get_issues`.

### Exemplo no repo

[`integrations/mcp/cursor.example.json`](../../integrations/mcp/cursor.example.json)

---

## 2. Claude Desktop

### Passos

1. Localize o arquivo de config:
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
2. Inclua (ou mescle) o bloco `mcpServers`:

```json
{
  "mcpServers": {
    "codehero": {
      "command": "npx",
      "args": ["-y", "codehero-mcp@latest"],
      "env": {
        "HERO_CORE_URL": "https://codehero.web.app/api",
        "HERO_TOKEN": "<cole-do-portal>",
        "HERO_ORG_ID": "<orgId>",
        "HERO_PROJECT_ID": "<projectId>",
        "HERO_REPO_ID": "<repoId>"
      }
    }
  }
}
```

3. **Feche e reabra** o Claude Desktop por completo.
4. No ícone de ferramentas / MCP, verifique se `codehero` está disponível.
5. No chat:

> Chame get_generation_context com entry: "regras de avaliação CodeHero" e use o retorno ao gerar código.

### Exemplo

[`integrations/mcp/claude_desktop.example.json`](../../integrations/mcp/claude_desktop.example.json)

---

## 3. GitHub Copilot (VS Code / coding agent)

### Passos

1. Abra o repositório no **VS Code** ou **Cursor** com extensão Copilot (Agent mode).
2. Crie `.vscode/mcp.json`:

```json
{
  "servers": {
    "codehero": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "codehero-mcp@latest"],
      "tools": [
        "get_generation_context",
        "get_active_rules",
        "get_issues",
        "get_sdd_spec",
        "run_scan",
        "submit_fix_result",
        "apply_sdd_workflow"
      ],
      "env": {
        "HERO_CORE_URL": "https://codehero.web.app/api",
        "HERO_TOKEN": "<cole-do-portal>",
        "HERO_ORG_ID": "<orgId>",
        "HERO_PROJECT_ID": "<projectId>",
        "HERO_REPO_ID": "<repoId>"
      }
    }
  }
}
```

3. Habilite **Agent mode** no Copilot Chat.
4. Confirme que as tools MCP aparecem / estão permitidas para a sessão.
5. Prompt sugerido (também no portal):

> Use o MCP CodeHero. Chame get_generation_context com entry: "Buscar as regras de avaliação de código (CodeHero) e aplicar no contexto". Depois liste issues e aplique o SDD.

### Exemplo

[`integrations/mcp/github_copilot.example.json`](../../integrations/mcp/github_copilot.example.json)

> **GitHub.com coding agent (cloud):** se o ambiente da Action/agent não tiver Node, use a imagem com Node 20+ ou configure o MCP no VS Code local. O formato acima é o suportado pelo Copilot Agent no editor.

---

## 4. Devin

O CodeHero MCP é **stdio** (`npx codehero-mcp`). No Devin há dois caminhos:

### 4A. Devin Web — Custom MCP (STDIO)

1. Abra [Settings → Connections → MCP servers](https://app.devin.ai/settings/connections?tab=mcps).
2. Clique **Add a custom MCP** (precisa de permissão *Manage MCP Servers*).
3. Preencha:
   - **Server Name:** `codehero`
   - **Transport:** **STDIO**
   - **Command:** `npx`
   - **Args:** `-y` e `codehero-mcp@latest` (conforme UI: lista de args)
   - **Environment variables:**
     - `HERO_CORE_URL` = `https://codehero.web.app/api`
     - `HERO_TOKEN` = token do portal
     - `HERO_ORG_ID` / `HERO_PROJECT_ID` / `HERO_REPO_ID`
4. Salve e inicie uma sessão Devin pedindo para chamar `get_generation_context` / `get_issues`.

Docs oficiais Devin (custom MCP): https://docs.devin.ai/work-with-devin/mcp

### 4B. Devin CLI / Local — `mcp_config.json`

Arquivos (escolha um escopo):

| Escopo | Caminho |
|---|---|
| Usuário (Linux/macOS) | `~/.config/devin/mcp_config.json` |
| Usuário (Windows) | `%APPDATA%\devin\mcp_config.json` |
| Projeto | `.devin/mcp_config.json` (pode commitá-lo **sem** token) |
| Projeto local | `.devin/mcp_config.local.json` (**gitignored** — coloque o token aqui) |

Conteúdo:

```json
{
  "mcpServers": {
    "codehero": {
      "command": "npx",
      "args": ["-y", "codehero-mcp@latest"],
      "env": {
        "HERO_CORE_URL": "https://codehero.web.app/api",
        "HERO_TOKEN": "<cole-do-portal>",
        "HERO_ORG_ID": "<orgId>",
        "HERO_PROJECT_ID": "<projectId>",
        "HERO_REPO_ID": "<repoId>"
      }
    }
  }
}
```

Ou via CLI:

```bash
devin mcp add codehero -t stdio --command npx -- -y codehero-mcp@latest \
  -e HERO_CORE_URL=https://codehero.web.app/api \
  -e HERO_TOKEN=... \
  -e HERO_ORG_ID=... \
  -e HERO_PROJECT_ID=... \
  -e HERO_REPO_ID=... \
  -s local
```

Liste: `devin mcp list` · detalhe: `devin mcp get codehero`

### Exemplo

[`integrations/mcp/devin.example.json`](../../integrations/mcp/devin.example.json)

---

## 5. Primeiro uso — checklist

| # | Ação | OK? |
|---|---|---|
| 1 | `npx -y codehero-mcp@latest` imprime `hero-mcp ready (stdio)` no stderr | |
| 2 | Agent vê as tools `get_generation_context`, `get_active_rules`, … | |
| 3 | `get_generation_context` devolve lista de regras | |
| 4 | `get_issues` lista findings (com token válido) | |
| 5 | `get_sdd_spec` + patch + `submit_fix_result` no fluxo de correção | |

### Tools

| Tool | Para quê |
|---|---|
| `get_generation_context` | Guardrails antes de gerar código |
| `get_active_rules` | Catálogo ativo |
| `get_issues` | Findings abertos |
| `get_sdd_spec` | Contrato de correção |
| `submit_fix_result` | Reportar applied / rejected / failed |
| `apply_sdd_workflow` | Roteiro verified-fix |
| `run_scan` | Opcional (precisa `HERO_SCANNER_CMD` local) |

---

## Links

- Portal: https://codehero.web.app → **Integração MCP**
- Docs produto: https://codehero.web.app/docs/#mcp
- Exemplos: https://github.com/nbsjunior/codehero/tree/main/integrations/mcp
- npm: https://www.npmjs.com/package/codehero-mcp
