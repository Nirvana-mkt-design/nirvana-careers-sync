# nirvana-careers-sync

Espelha o job board do Ashby na collection "Job Listings" da CMS do Webflow, que
alimenta `careers.nirvanatech.com/jobs`.

O Ashby e a fonte da verdade unica: vaga publicada la aparece no site; vaga que sai
de la e **arquivada** na CMS (nunca deletada).

## Como roda

Cron do GitHub Actions a cada 5 minutos. Tambem da pra disparar na mao em
**Actions -> sync -> Run workflow**, com as opcoes `dry_run` e `force`.

O GitHub nao garante pontualidade de cron: em horario de pico o intervalo real fica
entre 5 e 15 minutos.

## Setup

Secret `WEBFLOW_TOKEN` = site token do Webflow do site Nirvana Careers, com scopes
`cms:read` e `cms:write`.

Gerar em: site settings -> Apps & integrations -> fim da pagina -> API access.
**So admin do site enxerga essa secao.** Token de workspace nao serve: ele nao tem
acesso a CMS.

## Rodar local

```bash
node --test                                   # testes, sem rede
DRY_RUN=1 WEBFLOW_TOKEN=... npm run sync      # mostra o plano, nao escreve nada
WEBFLOW_TOKEN=... npm run sync                # aplica
```

## Guardas

- Ashby devolveu zero vagas, respondeu nao-2xx ou mandou payload torto -> aborta sem
  tocar no Webflow.
- Plano quer arquivar mais de 5 vagas -> aborta. Para liberar, rode manualmente com
  `force`.
- Rodadas simultaneas sao serializadas por `concurrency`.

## Campos derivados

`country-location` e `location-type` nao existem no Ashby de forma confiavel e sao
derivados por regex em `src/transform.js`. Escritorio novo = uma linha na tabela
`COUNTRY_RULES` e um teste. Corrigir a mao no Webflow nao adianta: a proxima rodada
sobrescreve.

## Fora de escopo

O filtro "Teams" da pagina `/jobs` lista times (Engineering, Claims, Data Science...)
mas o campo que o alimenta recebe o `department` do Ashby, que so assume `G&A`, `R&D`
e `Sales and Marketing`. Esses checkboxes retornam zero resultados, antes e depois
deste sync. Resolver depende do recruiting unificar a taxonomia.
