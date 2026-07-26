# CodeHero — plugin VS Code / Cursor

## Instalação

1. Baixe `codehero-vscode.vsix` em https://codehero.web.app
2. VS Code ou Cursor → **Extensions** → `⋯` → **Install from VSIX…**
3. Abra a **pasta do seu projeto** (Open Folder)

## Usar (scan local)

1. Clique no ícone **CodeHero** na barra lateral esquerda  
   *(ou no botão `CodeHero` na barra de status)*
2. Clique em **Rodar scan no workspace** (ícone ▶)
3. Veja a **Avaliação** no painel (por severidade) e os sublinhados em **Problems**

O scanner **determinístico** busca as regras ativas no servidor CodeHero antes de cada scan (canônicas + dress code do projeto). Sem rede, usa o cache/bundled.

## Configuração

Command Palette → `CodeHero: Abrir configurações`

| Setting | Padrão | Função |
|---|---|---|
| `codehero.scanOnSave` | true | Scan do arquivo ao salvar |
| `codehero.enableCache` | true | Cache incremental |
| `codehero.minSeverity` | INFO | Filtro de severidade no painel |
| `codehero.serverUrl` | Cloud Functions | Onde buscar `getActiveRules` |
| `codehero.token` / `orgId` / `projectId` | — | Dress code do projeto (overlays) |
| `codehero.scannerCommand` | *(vazio)* | Vazio = scanner embutido |

## Portal vs plugin

| | Plugin | Portal |
|---|---|---|
| Scan no seu código local | ✅ | — |
| Dress code em português | — | ✅ |
| Prévia de GitHub público | — | ✅ |
