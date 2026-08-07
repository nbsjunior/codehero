# @codehero/fp-ranker

Ranqueador de falso positivo do CodeHero.

Ordena achados por probabilidade de serem reais. O modelo é um **artefato versionado em arquivo** — não há inferência durante o scan, então o resultado é reprodutível.

O valor é personalização **por repositório**: cada instalação treina sobre os próprios rótulos e aponta `HERO_RANKER_MODEL` para o artefato resultante. O padrão são priors genéricos escritos à mão.

Pacote de biblioteca: você normalmente quer [`@codehero/scanner`](https://www.npmjs.com/package/@codehero/scanner).

## Licença

Apache-2.0. Código em <https://github.com/nbsjunior/codehero>.
