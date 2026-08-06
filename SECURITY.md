# Security Policy

## Reporting a vulnerability

**Não** abra issue pública com exploits, tokens ou dados de clientes.

Envie um relatório privado para os maintainers via
[GitHub Security Advisories](https://github.com/nbsjunior/codehero/security/advisories/new)
(ou o canal indicado no perfil do repositório).

Inclua:

- Descrição e impacto
- Passos para reproduzir (PoC mínimo)
- Versões / commit afetados
- Mitigações sugeridas (se houver)

Prazo típico de resposta inicial: **até 7 dias**.

## Escopo

| Em escopo | Fora de escopo |
|---|---|
| Scanner, contratos, ruleforge, MCP, Action, IDE | Contas cloud / painel de billing de terceiros |
| Autenticação e autorização no código deste repo | Ataques de phishing / social engineering |
| Vazamento de secrets **neste** repositório | DoS em infraestrutura de terceiros |

## Regras para contribuidores

- Nunca faça commit de `.env`, service accounts, chaves privadas ou tokens de ingestão
- Workflows de exemplo usam `${{ secrets.* }}` / `${{ vars.* }}` — sem IDs reais
- Não publique URLs internas de provedores (functions, buckets, project ids)
- Se encontrar um secret no histórico do git, avise imediatamente (pode exigir rotate + purge)

## Supported versions

Correções de segurança priorizam a branch `main` e releases marcadas.
