# Extensão VS Code / Cursor — CodeHero

Arquivo: `codehero-vscode.vsix`

## Instalação

1. Baixe o `.vsix` pelo portal (Configurações → Plugin VS Code).
2. No VS Code / Cursor: **Extensions → … → Install from VSIX…**
3. Abra as configurações da extensão e preencha:
   - `codehero.serverUrl` — URL da API do portal (fornecida na tela do projeto)
   - `codehero.token` — token de ingestão do repositório
   - `codehero.orgId` / `codehero.projectId` / `codehero.repoId` — IDs do portal

## Comandos

- **CodeHero: Analyze Workspace** — análise local + envio do relatório para a API
- **CodeHero: Show Last Report** — último resultado
- **CodeHero: Open Portal** — abre o CodeHero no navegador

## Observação

O scanner embutido (`bundled/hero-scan.cjs`) roda com o Node do próprio editor. Não use `npx` nem comandos externos.
