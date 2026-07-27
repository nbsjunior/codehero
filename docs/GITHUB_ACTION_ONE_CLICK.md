# GitHub Action — one-click (portal)

Clientes (devs / engenheiros donos do repo) **não configuram Firebase** e **não veem** URLs de Cloud Functions. Tudo passa pelo portal.

## O que o cliente faz

1. No portal → seu projeto → aba **GitHub Action** → **Configurar Action no GitHub (1 clique)**
2. Autoriza o GitHub (`repo` + `workflow`)
3. O CodeHero cria no repositório:
   - `.github/workflows/codehero.yml`
   - secret `HERO_TOKEN`
   - variable `HERO_CORE_URL` = `https://codehero.web.app/api`

Fallbacks na mesma aba: script `gh`, deep link, YAML — ainda sem mencionar Firebase.

## URLs públicas (portal)

| Uso | URL |
|---|---|
| OAuth callback | `https://codehero.web.app/projeto/githubOauthCallback` |
| API CI / scanner | `https://codehero.web.app/api/*` (rewrite → Functions) |

O Hosting reescreve essas rotas para as Functions; o cliente só vê `codehero.web.app`.

## Ops da plataforma (admin)

1. GitHub → **OAuth Apps → New OAuth App**
   - Homepage: `https://codehero.web.app`
   - **Authorization callback URL:** `https://codehero.web.app/projeto/githubOauthCallback`
2. Depois de criar o OAuth App, configure as env vars das Functions `startGithubActionInstall` e
   `githubOAuthCallback` no Google Cloud Console (ou Secret Manager + bind):

```text
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
```

   Sem isso o deploy sobe normalmente; o botão one-click avisa e o `gh`/deep link continuam disponíveis.

3. Deploy hosting + `startGithubActionInstall` + `githubOAuthCallback` (já no `firebase-deploy.yml`).

## Fluxo técnico

1. Callable `startGithubActionInstall` (auth Firebase do portal) → `githubOAuthStates/{state}` com `orgId`, `projectId`, `projectSlug`
2. Browser → GitHub authorize → callback no **portal** `/projeto/githubOauthCallback`
3. Function (via Hosting rewrite) troca o code, grava workflow/secrets com `HERO_CORE_URL=https://codehero.web.app/api`
4. Redirect → `/projects?org=&id=&slug=&tab=action&gha=ok`
