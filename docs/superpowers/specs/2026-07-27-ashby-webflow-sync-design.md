# Sync Ashby → Webflow CMS — Nirvana Careers

**Data:** 2026-07-27
**Status:** design aprovado, pendente de implementação

## Problema

A página `careers.nirvanatech.com/jobs` não consulta o Ashby. Ela renderiza a Collection
"Job Listings" da CMS do Webflow (site `nirvana-careers`, id `68481a33ab03304a33c6c1c9`)
usando Finsweet CMS Filter. Não existe nenhum script na página nem no site que fale com o
Ashby — a alimentação vinha de um Zap que quebrou, e desde então é feita a mão.

Consequências observadas na CMS em 2026-07-27:

| Sintoma | Evidência |
|---|---|
| Item vivo na página com registro em Draft | `6a19a2cb…` (Sr Manager, Corporate Development): `isDraft: true`, sem `lastPublished`, mas presente no HTML publicado. Cairia da página no próximo publish do site. |
| Vaga fechada ainda na CMS | `69bae5b2…` (Manager, Underwriting Strategy & Operations), job `63833d73` ausente da Posting API |
| Duplicata por ID corrompido | `6a1b29c0…` e `6a1dbb62…` apontam para o mesmo job `887d6784-…`; o primeiro tem `ashby-job-id` = `d6784-8238-40af-9e0f-9605209be981` (faltando o prefixo `887`) |
| Latência de dias | job publicado no Ashby em 11/05 virou item em 29/05; 15/07 → 17/07 |
| Publicação manual em lote | três itens publicados no mesmo segundo, 2026-07-21 13:43:18 |

## Objetivo

O Ashby é a fonte da verdade única. O que subir lá aparece na página; o que sair de lá some
da página. Sem intervenção humana no caminho feliz.

## Não-objetivos

- **Taxonomia do filtro "Teams" da página.** Os checkboxes são fixos e listam
  `Engineering, Product, Underwriting, Business Development, Insurance Product,
  Sales and Marketing, Claims, Data Science, People, Operations, G&A, R&D`, mas o campo
  `department` recebe o `department` do Ashby, que hoje só assume `G&A`, `R&D` e
  `Sales and Marketing`. Os demais checkboxes retornam zero resultados. O campo `team` do
  Ashby (`Fleet`, `Business Operations`, `Insurance Product`, `Finance`) também não bate com
  a lista da página. Resolver isso exige o time de recruiting decidir uma taxonomia única —
  é trabalho separado, registrado aqui como pendência.
- Página de detalhe `/job-listings/<slug>`: os cards linkam direto para `jobs.ashbyhq.com`,
  então a rota não é usada. Fora de escopo.
- Webhooks do Ashby / sync em tempo real. Exigiria endpoint hospedado.

## Arquitetura

Repositório público `Nirvana-mkt-design/nirvana-careers-sync`. Node 22, sem dependências
(fetch nativo), sem build step.

```
src/ashby.js       busca o board público, devolve vagas normalizadas
src/transform.js   PURO: vaga Ashby → fieldData do Webflow, inclui regras derivadas
src/reconcile.js   PURO: (vagas, itens) → plano { criar, atualizar, arquivar, desarquivar }
src/webflow.js     cliente da Data API v2: listar, criar, atualizar, publicar, despublicar
src/index.js       orquestra: busca → valida → planeja → aplica → publica → relata
```

`transform` e `reconcile` concentram toda a lógica falível e não tocam a rede, então são
testáveis isoladamente. `ashby` e `webflow` são cascas finas de I/O. `index` não decide nada:
só encadeia.

## Fluxo

1. `GET https://api.ashbyhq.com/posting-api/job-board/nirvana` — público, sem chave.
2. Normaliza as vagas.
3. `GET` todos os itens da collection `684c6540b149c4126f1c3502`.
4. Casa os dois lados por `ashby-job-id`.
5. Monta o plano.
6. Aplica no Webflow e publica os itens tocados.
7. Escreve o resumo no summary da execução.

Idempotente: a segunda rodada seguida produz plano vazio. É isso que torna seguro rodar de
5 em 5 minutos.

## Mapeamento de campos

| Campo CMS | Origem |
|---|---|
| `name` | `title` |
| `slug` | `id` |
| `ashby-job-id` | `id` |
| `job-url` | `jobUrl` |
| `date-published` | `publishedAt` |
| `department` | `department` |
| `full-location` | `location` |
| `job-type` | `employmentType` formatado: `FullTime`→`Full-time`, `PartTime`→`Part-time`, `Intern`→`Internship`, `Contract`→`Contract`, `Temporary`→`Temporary` |
| `country-location` | derivado (abaixo) |
| `location-type` | derivado (abaixo) |

### Regras derivadas

O Ashby não expõe país nem modalidade de forma confiável (`isRemote` vem `null` em 3 das 4
vagas atuais). Ambas as regras ficam num único objeto no topo de `transform.js`, com um teste
por linha:

- `country-location`: `/chile|santiago/i` → `Chile`;
  `/india|bengaluru|bangalore|mumbai|hyderabad|delhi|pune|gurgaon/i` → `India`;
  caso contrário → `United States`.
- `location-type`: `isRemote === true` ou a location casa `/remote/i` → `Remote`;
  caso contrário → `On-site`.

Como o Ashby manda em tudo, essas regras sobrescrevem o valor da CMS a cada rodada. Corrigir
uma vaga a mão no Webflow não persiste — o ajuste correto é na regra.

## Reconciliação

Casamento por `ashby-job-id` exato.

| Situação | Ação |
|---|---|
| Está no Ashby, não está na CMS | criar e publicar |
| Está nos dois, algum campo difere | atualizar e publicar |
| Está nos dois, tudo igual | nada |
| Está nos dois, mas o item está arquivado ou em draft | desarquivar, tirar de draft, publicar |
| Não está no Ashby, item ativo na CMS | despublicar e marcar `isArchived: true` |
| Não está no Ashby, item já arquivado | nada (não reescreve os itens velhos a cada rodada) |

Remoção é **arquivamento, não delete**. O efeito para o visitante é idêntico — a vaga some de
`/jobs` — mas é reversível, e delete na API do Webflow não é.

## Guardas

1. Ashby devolveu zero vagas → aborta sem escrever nada. Board vazio é quase sempre falha.
2. Resposta não-2xx ou JSON inválido → aborta.
3. Plano quer arquivar mais de 5 vagas numa rodada → aborta e falha o workflow. Só passa em
   execução manual com `FORCE=1`, depois de alguém ler o plano.
4. `429` do Webflow (limite de 60 req/min) → retry com backoff exponencial. Escritas vão em
   lote; uma rodada normal são ~3 chamadas.

## Agendamento

GitHub Actions, cron `*/5 * * * *` — o piso do GitHub. Repo público, então minutos de Actions
são ilimitados e o custo é zero. (Em repo privado a mesma frequência consumiria ~8.640
minutos/mês contra 2.000 de cota, porque o Actions arredonda cada execução para 1 minuto.)

O GitHub não garante pontualidade: em pico ele atrasa e às vezes pula agendamentos curtos. Na
prática o intervalo real fica entre 5 e 15 minutos.

Gatilhos adicionais:
- `workflow_dispatch` — botão "rodar agora" na aba Actions, para publicação urgente.
- `repository_dispatch` — permite que qualquer automação futura dispare o sync na hora.

## Erros e observabilidade

- Falha deixa o workflow vermelho; o GitHub notifica quem observa o repo.
- Cada execução escreve `criadas / atualizadas / arquivadas / inalteradas` no job summary.
- `state/last-sync.json` é commitado **apenas quando houve mudança** — commitar toda rodada
  geraria ~8.640 commits/mês de ruído.
- Um cron mensal de heartbeat mantém o agendamento vivo: o GitHub desativa cron de repositório
  sem atividade há 60 dias.

## Testes

`node --test`, sobre as funções puras, sem rede:

- `country-location` para Santiago, Bengaluru, San Francisco, "United States", "Remote"
- `location-type` para `isRemote: true`, location "Remote", location de cidade
- formatação de `employmentType`
- `reconcile` nos cinco casos: criar, atualizar, arquivar, desarquivar, no-op
- guarda de zero vagas
- guarda de arquivamento em massa

## Rollout

`DRY_RUN=1` imprime o plano sem escrever. A primeira execução é assim, e o plano é revisado
antes de o cron ser ligado.

Estado em 2026-07-27: 4 vagas no Ashby, 22 itens na CMS — 5 ativos e 17 já arquivados. O plano
da primeira rodada, calculado sobre esses dados:

| Ação | Item |
|---|---|
| nada | Strategic Finance Manager |
| nada | Compliance Analyst |
| nada | Senior Fleet Underwriter |
| atualizar + publicar | Sr Manager, Corporate Development (sai de Draft) |
| arquivar | Manager, Underwriting Strategy & Operations (fechada no Ashby) |
| — | nenhuma vaga a criar |

Os 17 itens já arquivados ficam intocados, inclusive a duplicata de `ashby-job-id` truncado
(`d6784-…`), que já está arquivada e portanto é no-op. O ID corrompido não volta a causar dano
porque o casamento é por igualdade exata: ele simplesmente nunca casa com nada do Ashby.

A guarda 3 **não** dispara nessa rodada — é um único arquivamento, bem abaixo do limite de 5.
`FORCE=1` não é necessário.

## Dependências externas

1. **`WEBFLOW_TOKEN`** — token da Site API do Nirvana Careers com escrita de CMS
   (Site settings → Apps & integrations → API access), guardado em GitHub Secrets. Não entra
   no código. Secrets não são legíveis em repositório público; só o workflow em execução os vê.
2. **Permissão** para criar o repositório na org `Nirvana-mkt-design`.

## Referências

- Site: `68481a33ab03304a33c6c1c9` · Collection "Job Listings": `684c6540b149c4126f1c3502`
- Página Jobs: `684ca8d902d794ce2ed7e408`
- Board público: https://jobs.ashbyhq.com/nirvana
- Posting API: https://api.ashbyhq.com/posting-api/job-board/nirvana
