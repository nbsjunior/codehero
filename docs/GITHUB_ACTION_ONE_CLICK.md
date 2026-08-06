# GitHub Action — one-click (portal)

Clientes (devs / engenheiros donos do repo) **não configuram a Cloud** e **não veem** URLs internas da API. Tudo passa pelo portal.

## O que o cliente faz

1. No portal → seu projeto → aba **GitHub Action** → **Configurar Action no GitHub (1 clique)**
2. Autoriza o GitHub (`repo` + `workflow`)
3. O CodeHero cria no repositório:
   - `.github/workflows/codehero.yml`
   - secret `HERO_TOKEN`
   - variable `HERO_CORE_URL` = `https://codehero.web.app/api`

Fallbacks na mesma aba: script `gh`, deep link, YAML — sem expor detalhes de infra.

## URLs públicas (portal)

| Uso | URL |
|---|---|
| OAuth callback | `https://codehero.web.app/projeto/githubOauthCallback` |
| API CI / scanner | `https://codehero.web.app/api/*` |

O portal reescreve essas rotas para a API interna; o cliente só vê `codehero.web.app`.

## Ops da plataforma (admin)

1. GitHub → **OAuth Apps → New OAuth App**
   - Homepage: `https://codehero.web.app`
   - **Authorization callback URL:** `https://codehero.web.app/projeto/githubOauthCallback`
2. Depois de criar o OAuth App, configure as env vars da API (`startGithubActionInstall` e
   `githubOAuthCallback`) no console da Cloud (ou gerenciador de secrets):

```text
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
```

   Sem isso o deploy sobe normalmente; o botão one-click avisa e o `gh`/deep link continuam disponíveis.

3. Deploy do portal + endpoints de install/callback OAuth.

## Fluxo técnico

1. Chamada autenticada `startGithubActionInstall` → estado OAuth com `orgId`, `projectId`, `projectSlug`
2. Browser → GitHub authorize → callback no **portal** `/projeto/githubOauthCallback`
3. API (via rewrite do portal) troca o code, grava workflow/secrets com `HERO_CORE_URL=https://codehero.web.app/api`
4. Redirect → `/projects?org=&id=&slug=&tab=action&gha=ok`

## Presence Pack (SARIF / profundidade)

Para repos JS/TS (ou multi-lang) que querem profundidade sem stub Sonar, ligue na Action (ou no YAML gerado):

| Input | Efeito |
|---|---|
| `metrics` | Default `true` — métricas de débito no CI |
| `semantic` | Taint/semantic TS mais profundo |
| `oxlint` | Roda Oxlint → `EXT:oxlint:*` |
| `semgrep` | Roda Semgrep → `EXT:semgrep:*` |
| `sca` + `sca-tool` | Trivy ou osv-scanner → SCA no gate |
| `import-sarif` | Paths de SARIF já gerados (ex.: CodeQL) |

New-code no upload usa **diff por linha** (`git diff -U0`) quando possível.

Matriz completa: [docs/wiki/Presenca-SARIF.md](wiki/Presenca-SARIF.md). Workflow de exemplo: [`examples/github-workflows/codehero-presence.example.yml`](../examples/github-workflows/codehero-presence.example.yml).
