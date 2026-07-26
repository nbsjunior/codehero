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

O scanner **determinístico** vem embutido (padrão + AST + taint). Não chama IA por arquivo.

## Configuração

Command Palette → `CodeHero: Abrir configurações`

| Setting | Padrão | Função |
|---|---|---|
| `codehero.scanOnSave` | true | Scan do arquivo ao salvar |
| `codehero.enableCache` | true | Cache incremental |
| `codehero.minSeverity` | INFO | Filtro de severidade no painel |
| `codehero.scannerCommand` | *(vazio)* | Vazio = scanner embutido |
| `codehero.orgId` / `projectId` | — | Opcional, vínculo com o portal |

## Portal vs plugin

| | Plugin | Portal |
|---|---|---|
| Scan no seu código local | ✅ | — |
| Dress code em português | — | ✅ |
| Prévia de GitHub público | — | ✅ |
