# Contributing to CodeHero

Obrigado por contribuir. Este repositório é **open source**: scanner, contratos, ruleforge, MCP, Action e IDE.
A operação da plataforma hospedada (deploy, contas cloud, secrets de produção) **não** faz parte das contribuições públicas.

## Antes de abrir um PR

1. Leia [SECURITY.md](./SECURITY.md) — nunca envie secrets, tokens ou IDs de tenant reais.
2. Abra uma issue descrevendo o problema/feature (exceto typos óbvios).
3. Rode localmente:

```bash
npm ci
npm run build:contracts
npm test
```

## Escopo bem-vindo

- Regras / corpus / testes do motor (`packages/contracts`, `packages/engine`, `packages/ruleforge`)
- Scanner, Action, MCP, IDE
- Docs de produto e wiki (`docs/wiki`, textos do portal)
- Correções de bugs e melhorias de DX

## Fora de escopo (não aceite em PR público)

- Workflows de deploy de produção
- Credenciais, service accounts, `.env` com valores reais
- IDs de org/projeto/repo de clientes
- Documentação operacional de infraestrutura (provedores, inventário de recursos)

## Estilo

- TypeScript nos pacotes do monorepo; testes em `*.mjs` onde já existir padrão
- Prefira `;` em PowerShell local; nos workflows use bash
- Mensagens de commit em português ou inglês, no estilo do histórico (`feat:`, `fix:`, `docs:`)

## Pull requests

- Um PR = um tema
- Inclua passos de teste no template
- CI (`ci.yml`) deve passar: build dos pacotes + testes

## Código de conduta

Participação regida por [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
