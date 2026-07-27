# Sync Ashby → Webflow CMS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Espelhar automaticamente o job board público do Ashby na collection "Job Listings" da CMS do Webflow, de modo que `careers.nirvanatech.com/jobs` reflita o Ashby sem intervenção humana.

**Architecture:** Um script Node sem dependências, rodando em cron do GitHub Actions. Cada execução lê o board inteiro do Ashby e a collection inteira do Webflow, calcula um plano de reconciliação em funções puras, e aplica. Toda a lógica falível (`transform`, `reconcile`) é pura e testada sem rede; `ashby` e `webflow` são cascas finas de I/O com `fetch` injetável.

**Tech Stack:** Node 22 (ESM, `fetch` nativo), `node:test` + `node:assert/strict`, GitHub Actions. Zero dependências de runtime e de teste.

## Global Constraints

- Node >= 22. ESM (`"type": "module"` no package.json). Sem build step.
- **Zero dependências** — nem runtime, nem dev. Sem `node_modules`, sem lockfile.
- **O token nunca é logado, commitado ou escrito em arquivo.** Só via `process.env.WEBFLOW_TOKEN`.
- **Ashby é a fonte da verdade única.** Todo campo gerenciado é sobrescrito a cada rodada.
- **Remoção é arquivamento, nunca delete.** Nenhum código deste projeto pode chamar `DELETE` em um item de CMS.
- Limite de arquivamento por rodada: **5**. Acima disso, aborta salvo `FORCE=1`.
- IDs fixos: site `68481a33ab03304a33c6c1c9`, collection Job Listings `684c6540b149c4126f1c3502`.
- Board Ashby: `https://api.ashbyhq.com/posting-api/job-board/nirvana` (público, sem chave).
- Todas as mensagens de log e de erro em português.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `package.json` | metadados, `"type": "module"`, scripts `test` e `sync` |
| `src/config.js` | constantes: IDs, URLs, limite de arquivamento, lista de campos gerenciados |
| `src/transform.js` | **puro** — vaga do Ashby → fieldData do Webflow, incluindo as regras derivadas |
| `src/reconcile.js` | **puro** — (desejado, atual) → plano; e a guarda de arquivamento em massa |
| `src/ashby.js` | I/O — busca e valida o board |
| `src/webflow.js` | I/O — cliente da Data API v2 com retry |
| `src/index.js` | orquestrador — encadeia, decide DRY_RUN, escreve summary e state |
| `test/transform.test.js` | testes das regras derivadas e do mapeamento |
| `test/reconcile.test.js` | testes dos cinco casos de plano e das guardas |
| `test/ashby.test.js` | testes das guardas de resposta, com `fetch` stub |
| `.github/workflows/sync.yml` | cron `*/5`, `workflow_dispatch`, `repository_dispatch` |
| `.github/workflows/heartbeat.yml` | cron mensal que mantém o agendamento vivo |
| `README.md` | setup, secrets, como rodar dry run, como disparar na mão |

---

### Task 1: Scaffold + `transform.js` (regras derivadas e mapeamento)

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/config.js`
- Create: `src/transform.js`
- Test: `test/transform.test.js`

**Interfaces:**
- Consumes: nada (primeira task)
- Produces:
  - `config.js`: `SITE_ID`, `COLLECTION_ID`, `ASHBY_BOARD_URL`, `MAX_ARCHIVE_PER_RUN`, `MANAGED_FIELDS` (array de strings)
  - `transform.js`: `formatEmploymentType(value: string|null|undefined) -> string`, `deriveCountry(location: string|null|undefined) -> 'Chile'|'India'|'United States'`, `deriveLocationType(job: object) -> 'Remote'|'On-site'`, `toFieldData(job: object) -> object` com exatamente as chaves de `MANAGED_FIELDS`

- [ ] **Step 1: Criar `package.json` e `.gitignore`**

`package.json`:
```json
{
  "name": "nirvana-careers-sync",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test",
    "sync": "node src/index.js"
  }
}
```

`.gitignore`:
```
node_modules/
.env
*.local
```

- [ ] **Step 2: Criar `src/config.js`**

```js
export const SITE_ID = '68481a33ab03304a33c6c1c9'
export const COLLECTION_ID = '684c6540b149c4126f1c3502'
export const ASHBY_BOARD_URL = 'https://api.ashbyhq.com/posting-api/job-board/nirvana'
export const WEBFLOW_API = 'https://api.webflow.com/v2'

// Acima disso o sync aborta: arquivamento em massa quase sempre é falha de leitura.
export const MAX_ARCHIVE_PER_RUN = 5

// Os únicos campos que o sync gerencia. Comparação e escrita se limitam a eles.
export const MANAGED_FIELDS = [
  'name',
  'slug',
  'ashby-job-id',
  'job-url',
  'date-published',
  'department',
  'full-location',
  'job-type',
  'country-location',
  'location-type',
]
```

- [ ] **Step 3: Escrever o teste que falha**

`test/transform.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatEmploymentType,
  deriveCountry,
  deriveLocationType,
  toFieldData,
} from '../src/transform.js'

test('formatEmploymentType traduz os valores do Ashby', () => {
  assert.equal(formatEmploymentType('FullTime'), 'Full-time')
  assert.equal(formatEmploymentType('PartTime'), 'Part-time')
  assert.equal(formatEmploymentType('Intern'), 'Internship')
  assert.equal(formatEmploymentType('Contract'), 'Contract')
  assert.equal(formatEmploymentType('Temporary'), 'Temporary')
})

test('formatEmploymentType devolve string vazia para valor ausente ou desconhecido', () => {
  assert.equal(formatEmploymentType(null), '')
  assert.equal(formatEmploymentType(undefined), '')
  assert.equal(formatEmploymentType('Bizarro'), '')
})

test('deriveCountry reconhece Chile', () => {
  assert.equal(deriveCountry('Santiago, Chile'), 'Chile')
  assert.equal(deriveCountry('chile'), 'Chile')
})

test('deriveCountry reconhece India', () => {
  assert.equal(deriveCountry('Bengaluru, India'), 'India')
  assert.equal(deriveCountry('Bangalore'), 'India')
  assert.equal(deriveCountry('Hyderabad'), 'India')
})

test('deriveCountry cai em United States por padrao', () => {
  assert.equal(deriveCountry('San Francisco, CA'), 'United States')
  assert.equal(deriveCountry('United States'), 'United States')
  assert.equal(deriveCountry('Remote'), 'United States')
  assert.equal(deriveCountry(''), 'United States')
  assert.equal(deriveCountry(null), 'United States')
})

test('deriveLocationType usa isRemote quando presente', () => {
  assert.equal(deriveLocationType({ isRemote: true, location: 'San Francisco, CA' }), 'Remote')
})

test('deriveLocationType cai no texto da location quando isRemote e nulo', () => {
  assert.equal(deriveLocationType({ isRemote: null, location: 'Remote' }), 'Remote')
  assert.equal(deriveLocationType({ isRemote: null, location: 'San Francisco, CA' }), 'On-site')
  assert.equal(deriveLocationType({ isRemote: null, location: 'United States' }), 'On-site')
})

test('toFieldData mapeia uma vaga real do Ashby', () => {
  const job = {
    id: '5ba96b77-ddc5-45e1-a047-8ca241a19889',
    title: 'Senior Fleet Underwriter',
    department: 'Sales and Marketing',
    location: 'Remote',
    employmentType: 'FullTime',
    isRemote: true,
    publishedAt: '2026-06-09T15:51:05.005+00:00',
    jobUrl: 'https://jobs.ashbyhq.com/nirvana/5ba96b77-ddc5-45e1-a047-8ca241a19889',
  }

  assert.deepEqual(toFieldData(job), {
    name: 'Senior Fleet Underwriter',
    slug: '5ba96b77-ddc5-45e1-a047-8ca241a19889',
    'ashby-job-id': '5ba96b77-ddc5-45e1-a047-8ca241a19889',
    'job-url': 'https://jobs.ashbyhq.com/nirvana/5ba96b77-ddc5-45e1-a047-8ca241a19889',
    'date-published': '2026-06-09T15:51:05.005Z',
    department: 'Sales and Marketing',
    'full-location': 'Remote',
    'job-type': 'Full-time',
    'country-location': 'United States',
    'location-type': 'Remote',
  })
})

test('toFieldData normaliza a data para o formato Z, senao toda rodada veria diferenca', () => {
  const job = { id: 'x', title: 'T', publishedAt: '2026-07-15T14:24:37.373+00:00' }
  assert.equal(toFieldData(job)['date-published'], '2026-07-15T14:24:37.373Z')
})

test('toFieldData tolera campos ausentes sem quebrar', () => {
  const out = toFieldData({ id: 'abc', title: 'Sem nada' })
  assert.equal(out.name, 'Sem nada')
  assert.equal(out.slug, 'abc')
  assert.equal(out.department, '')
  assert.equal(out['full-location'], '')
  assert.equal(out['date-published'], '')
})
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run: `node --test test/transform.test.js`
Expected: FAIL — `Cannot find module '../src/transform.js'`

- [ ] **Step 5: Implementar `src/transform.js`**

```js
import { MANAGED_FIELDS } from './config.js'

// O Ashby nao expoe pais nem modalidade de forma confiavel (isRemote vem null na
// maioria das vagas). Estas duas tabelas sao as unicas regras derivadas do projeto:
// quando abrir escritorio novo, e uma linha aqui e um teste.
const COUNTRY_RULES = [
  [/chile|santiago/i, 'Chile'],
  [/india|bengaluru|bangalore|mumbai|hyderabad|delhi|pune|gurgaon/i, 'India'],
]
const DEFAULT_COUNTRY = 'United States'

const EMPLOYMENT_TYPES = {
  FullTime: 'Full-time',
  PartTime: 'Part-time',
  Intern: 'Internship',
  Contract: 'Contract',
  Temporary: 'Temporary',
}

export function formatEmploymentType(value) {
  return EMPLOYMENT_TYPES[value] ?? ''
}

export function deriveCountry(location) {
  const text = location ?? ''
  for (const [pattern, country] of COUNTRY_RULES) {
    if (pattern.test(text)) return country
  }
  return DEFAULT_COUNTRY
}

export function deriveLocationType(job) {
  if (job.isRemote === true) return 'Remote'
  return /remote/i.test(job.location ?? '') ? 'Remote' : 'On-site'
}

// A data precisa virar sempre o mesmo formato: o Ashby manda "+00:00" e o Webflow
// devolve "Z". Sem normalizar, a comparacao acusaria diferenca em toda rodada e o
// sync ficaria reescrevendo os mesmos itens pra sempre.
function normalizeDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function toFieldData(job) {
  const fieldData = {
    name: job.title ?? '',
    slug: job.id,
    'ashby-job-id': job.id,
    'job-url': job.jobUrl ?? '',
    'date-published': normalizeDate(job.publishedAt),
    department: job.department ?? '',
    'full-location': job.location ?? '',
    'job-type': formatEmploymentType(job.employmentType),
    'country-location': deriveCountry(job.location),
    'location-type': deriveLocationType(job),
  }

  // Trava de consistencia: o objeto tem que ter exatamente os campos gerenciados,
  // senao a comparacao do reconcile silenciosamente ignora um campo novo.
  const keys = Object.keys(fieldData).sort()
  const expected = [...MANAGED_FIELDS].sort()
  if (keys.join() !== expected.join()) {
    throw new Error(`toFieldData desalinhado com MANAGED_FIELDS: ${keys.join()} != ${expected.join()}`)
  }

  return fieldData
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `node --test test/transform.test.js`
Expected: PASS — 10 testes

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore src/config.js src/transform.js test/transform.test.js
git commit -m "feat: mapeamento Ashby -> fieldData do Webflow com regras derivadas"
```

---

### Task 2: `reconcile.js` (plano de reconciliação e guardas)

**Files:**
- Create: `src/reconcile.js`
- Test: `test/reconcile.test.js`

**Interfaces:**
- Consumes: `config.js` → `MANAGED_FIELDS`, `MAX_ARCHIVE_PER_RUN`
- Produces:
  - `buildPlan(desired: object[], items: object[]) -> { create: object[], update: {itemId: string, fieldData: object}[], archive: {itemId: string, name: string}[], unchanged: string[] }`
    - `desired` = saída de `toFieldData`, uma por vaga do Ashby
    - `items` = itens crus da Data API do Webflow (`{ id, isArchived, isDraft, fieldData }`)
  - `assertArchiveLimit(plan: object, options?: { force?: boolean }) -> void` — lança se exceder
  - `isEmptyPlan(plan: object) -> boolean`

- [ ] **Step 1: Escrever o teste que falha**

`test/reconcile.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan, assertArchiveLimit, isEmptyPlan } from '../src/reconcile.js'

// Helper: monta um fieldData completo com o minimo de ruido no teste.
function fd(id, overrides = {}) {
  return {
    name: `Vaga ${id}`,
    slug: id,
    'ashby-job-id': id,
    'job-url': `https://jobs.ashbyhq.com/nirvana/${id}`,
    'date-published': '2026-06-01T00:00:00.000Z',
    department: 'R&D',
    'full-location': 'San Francisco, CA',
    'job-type': 'Full-time',
    'country-location': 'United States',
    'location-type': 'On-site',
    ...overrides,
  }
}

function item(itemId, fieldData, { isArchived = false, isDraft = false } = {}) {
  return { id: itemId, isArchived, isDraft, fieldData }
}

test('vaga no Ashby que nao existe na CMS entra em create', () => {
  const plan = buildPlan([fd('a')], [])
  assert.equal(plan.create.length, 1)
  assert.equal(plan.create[0]['ashby-job-id'], 'a')
  assert.equal(plan.update.length, 0)
  assert.equal(plan.archive.length, 0)
})

test('vaga identica nos dois lados nao gera acao', () => {
  const plan = buildPlan([fd('a')], [item('item-1', fd('a'))])
  assert.deepEqual(plan.unchanged, ['item-1'])
  assert.equal(plan.create.length, 0)
  assert.equal(plan.update.length, 0)
  assert.equal(plan.archive.length, 0)
})

test('campo divergente gera update', () => {
  const plan = buildPlan([fd('a', { name: 'Titulo novo' })], [item('item-1', fd('a'))])
  assert.equal(plan.update.length, 1)
  assert.equal(plan.update[0].itemId, 'item-1')
  assert.equal(plan.update[0].fieldData.name, 'Titulo novo')
})

test('item em draft com dados iguais ainda gera update, para voltar ao ar', () => {
  const plan = buildPlan([fd('a')], [item('item-1', fd('a'), { isDraft: true })])
  assert.equal(plan.update.length, 1)
  assert.equal(plan.update[0].itemId, 'item-1')
})

test('item arquivado cuja vaga reabriu no Ashby gera update (desarquiva)', () => {
  const plan = buildPlan([fd('a')], [item('item-1', fd('a'), { isArchived: true })])
  assert.equal(plan.update.length, 1)
})

test('item ativo que sumiu do Ashby entra em archive', () => {
  const plan = buildPlan([], [item('item-1', fd('a'))])
  assert.equal(plan.archive.length, 1)
  assert.equal(plan.archive[0].itemId, 'item-1')
  assert.equal(plan.archive[0].name, 'Vaga a')
})

test('item ja arquivado que sumiu do Ashby e ignorado, nao rearquivado', () => {
  const plan = buildPlan([], [item('item-1', fd('a'), { isArchived: true })])
  assert.equal(plan.archive.length, 0)
  assert.equal(plan.update.length, 0)
  assert.equal(plan.create.length, 0)
})

test('campos fora dos gerenciados nao contam como diferenca', () => {
  const cmsFieldData = { ...fd('a'), 'campo-manual': 'qualquer coisa' }
  const plan = buildPlan([fd('a')], [item('item-1', cmsFieldData)])
  assert.equal(plan.update.length, 0)
  assert.deepEqual(plan.unchanged, ['item-1'])
})

test('ashby-job-id corrompido nao casa com nada e o item e tratado como ausente', () => {
  const corrupted = { ...fd('a'), 'ashby-job-id': 'd6784-truncado' }
  const plan = buildPlan([fd('a')], [item('item-velho', corrupted)])
  assert.equal(plan.create.length, 1)
  assert.equal(plan.archive.length, 1)
  assert.equal(plan.archive[0].itemId, 'item-velho')
})

test('assertArchiveLimit deixa passar ate 5 arquivamentos', () => {
  const plan = { create: [], update: [], unchanged: [], archive: Array.from({ length: 5 }, (_, i) => ({ itemId: `i${i}`, name: `n${i}` })) }
  assert.doesNotThrow(() => assertArchiveLimit(plan))
})

test('assertArchiveLimit aborta acima de 5 arquivamentos', () => {
  const plan = { create: [], update: [], unchanged: [], archive: Array.from({ length: 6 }, (_, i) => ({ itemId: `i${i}`, name: `n${i}` })) }
  assert.throws(() => assertArchiveLimit(plan), /arquivar 6 vagas/)
})

test('assertArchiveLimit libera com force', () => {
  const plan = { create: [], update: [], unchanged: [], archive: Array.from({ length: 20 }, (_, i) => ({ itemId: `i${i}`, name: `n${i}` })) }
  assert.doesNotThrow(() => assertArchiveLimit(plan, { force: true }))
})

test('isEmptyPlan distingue plano vazio de plano com acao', () => {
  assert.equal(isEmptyPlan({ create: [], update: [], archive: [], unchanged: ['x'] }), true)
  assert.equal(isEmptyPlan({ create: [{}], update: [], archive: [], unchanged: [] }), false)
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/reconcile.test.js`
Expected: FAIL — `Cannot find module '../src/reconcile.js'`

- [ ] **Step 3: Implementar `src/reconcile.js`**

```js
import { MANAGED_FIELDS, MAX_ARCHIVE_PER_RUN } from './config.js'

// Compara apenas os campos gerenciados. Qualquer outro campo que exista na CMS e
// ignorado de proposito: o sync nao e dono dele.
function differs(desired, current) {
  const actual = current ?? {}
  return MANAGED_FIELDS.some((field) => (desired[field] ?? '') !== (actual[field] ?? ''))
}

export function buildPlan(desired, items) {
  const plan = { create: [], update: [], archive: [], unchanged: [] }

  const byAshbyId = new Map()
  for (const item of items) {
    const key = item.fieldData?.['ashby-job-id']
    // Casamento por igualdade exata. IDs corrompidos simplesmente nunca casam,
    // e o item cai no ramo de arquivamento como qualquer orfao.
    if (key) byAshbyId.set(key, item)
  }

  const seen = new Set()

  for (const fieldData of desired) {
    const key = fieldData['ashby-job-id']
    const item = byAshbyId.get(key)

    if (!item) {
      plan.create.push(fieldData)
      continue
    }

    seen.add(item.id)

    // Precisa de update se algum campo mudou OU se o item esta fora do ar
    // (arquivado/draft) mas a vaga continua aberta no Ashby.
    if (item.isArchived || item.isDraft || differs(fieldData, item.fieldData)) {
      plan.update.push({ itemId: item.id, fieldData })
    } else {
      plan.unchanged.push(item.id)
    }
  }

  for (const item of items) {
    if (seen.has(item.id)) continue
    // Ja arquivado e ausente do Ashby: no-op. Sem isso, os itens velhos seriam
    // reescritos em toda rodada.
    if (item.isArchived) continue
    plan.archive.push({ itemId: item.id, name: item.fieldData?.name ?? '(sem nome)' })
  }

  return plan
}

export function assertArchiveLimit(plan, { force = false } = {}) {
  if (force) return
  if (plan.archive.length > MAX_ARCHIVE_PER_RUN) {
    const nomes = plan.archive.map((a) => `  - ${a.name}`).join('\n')
    throw new Error(
      `Plano quer arquivar ${plan.archive.length} vagas, acima do limite de ${MAX_ARCHIVE_PER_RUN}.\n` +
        `Isso costuma indicar leitura parcial do Ashby, nao fechamento real.\n` +
        `Revise a lista e, se estiver correta, rode manualmente com FORCE=1:\n${nomes}`
    )
  }
}

export function isEmptyPlan(plan) {
  return plan.create.length === 0 && plan.update.length === 0 && plan.archive.length === 0
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/reconcile.test.js`
Expected: PASS — 13 testes

- [ ] **Step 5: Commit**

```bash
git add src/reconcile.js test/reconcile.test.js
git commit -m "feat: plano de reconciliacao com guarda de arquivamento em massa"
```

---

### Task 3: `ashby.js` (busca e guardas de resposta)

**Files:**
- Create: `src/ashby.js`
- Test: `test/ashby.test.js`

**Interfaces:**
- Consumes: `config.js` → `ASHBY_BOARD_URL`
- Produces: `fetchJobs(options?: { fetchImpl?: Function }) -> Promise<object[]>` — devolve o array `jobs` do board; lança em não-2xx, JSON inválido, formato inesperado ou lista vazia

- [ ] **Step 1: Escrever o teste que falha**

`test/ashby.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchJobs } from '../src/ashby.js'

// Stub minimo de fetch: devolve o que o teste mandar.
function stub({ ok = true, status = 200, body = { jobs: [] } }) {
  return async () => ({
    ok,
    status,
    json: async () => body,
  })
}

test('devolve as vagas quando o board responde bem', async () => {
  const jobs = [{ id: 'a', title: 'Uma vaga' }]
  const result = await fetchJobs({ fetchImpl: stub({ body: { jobs } }) })
  assert.deepEqual(result, jobs)
})

test('aborta quando o board devolve zero vagas', async () => {
  await assert.rejects(
    () => fetchJobs({ fetchImpl: stub({ body: { jobs: [] } }) }),
    /zero vagas/
  )
})

test('aborta em resposta nao-2xx', async () => {
  await assert.rejects(
    () => fetchJobs({ fetchImpl: stub({ ok: false, status: 503 }) }),
    /503/
  )
})

test('aborta quando o payload nao tem o array jobs', async () => {
  await assert.rejects(
    () => fetchJobs({ fetchImpl: stub({ body: { qualquer: 'coisa' } }) }),
    /formato inesperado/
  )
})

test('aborta quando o corpo nao e JSON valido', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
  })
  await assert.rejects(() => fetchJobs({ fetchImpl }), /JSON/)
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/ashby.test.js`
Expected: FAIL — `Cannot find module '../src/ashby.js'`

- [ ] **Step 3: Implementar `src/ashby.js`**

```js
import { ASHBY_BOARD_URL } from './config.js'

export async function fetchJobs({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(ASHBY_BOARD_URL, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Ashby respondeu ${response.status}. Abortando sem tocar no Webflow.`)
  }

  let payload
  try {
    payload = await response.json()
  } catch (cause) {
    throw new Error('Resposta do Ashby nao e JSON valido. Abortando.', { cause })
  }

  if (!Array.isArray(payload?.jobs)) {
    throw new Error('Payload do Ashby em formato inesperado: sem array "jobs". Abortando.')
  }

  // Board vazio e quase sempre falha de leitura, nao fim das contratacoes.
  // Se um dia o Nirvana realmente zerar as vagas, roda manualmente com FORCE=1.
  if (payload.jobs.length === 0) {
    throw new Error('Ashby devolveu zero vagas. Abortando sem tocar no Webflow.')
  }

  return payload.jobs
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/ashby.test.js`
Expected: PASS — 5 testes

- [ ] **Step 5: Verificar contra a API real (read-only)**

Run: `node -e "import('./src/ashby.js').then(async m => { const j = await m.fetchJobs(); console.log(j.length, 'vagas:', j.map(x => x.title)) })"`
Expected: imprime a contagem e os títulos do board atual. Nenhuma escrita.

- [ ] **Step 6: Commit**

```bash
git add src/ashby.js test/ashby.test.js
git commit -m "feat: leitura do board do Ashby com guardas de resposta"
```

---

### Task 4: `webflow.js` (cliente da Data API v2)

**Files:**
- Create: `src/webflow.js`

**Interfaces:**
- Consumes: `config.js` → `WEBFLOW_API`, `COLLECTION_ID`
- Produces:
  - `listItems(options?: { fetchImpl?: Function }) -> Promise<object[]>` — todos os itens, paginado
  - `createItems(fieldDataList: object[], options?) -> Promise<void>` — cria como draft
  - `updateItems(updates: {itemId, fieldData}[], options?) -> Promise<void>` — grava e tira de draft/arquivo
  - `publishItems(itemIds: string[], options?) -> Promise<void>`
  - `archiveItems(itemIds: string[], options?) -> Promise<void>` — despublica e marca `isArchived`

**Nota de integração:** os formatos exatos de payload seguem a [Data API v2](https://developers.webflow.com/data/reference/cms/collection-items/bulk-items). Este módulo não tem teste unitário: ele é casca de I/O e é validado pelo dry run da Task 6 e pela primeira execução real da Task 7. A lógica que pode errar mora em `transform` e `reconcile`, que são testados.

- [ ] **Step 1: Implementar `src/webflow.js`**

```js
import { WEBFLOW_API, COLLECTION_ID } from './config.js'

const MAX_RETRIES = 4
const BASE_DELAY_MS = 1000

function token() {
  const value = process.env.WEBFLOW_TOKEN
  if (!value) throw new Error('WEBFLOW_TOKEN nao definido no ambiente.')
  return value
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Retry so em 429 e 5xx. 4xx de verdade (payload errado, escopo faltando) falha
// na hora: repetir nao conserta e so mascara o erro.
async function request(path, { method = 'GET', body, fetchImpl = fetch } = {}) {
  let lastError

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetchImpl(`${WEBFLOW_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token()}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (response.ok) {
      return response.status === 204 ? null : response.json()
    }

    const text = await response.text().catch(() => '')

    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`Webflow respondeu ${response.status} em ${method} ${path}: ${text}`)
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * 2 ** attempt)
        continue
      }
    }

    // A mensagem nunca inclui o token; so status, rota e corpo da resposta.
    throw new Error(`Webflow respondeu ${response.status} em ${method} ${path}: ${text}`)
  }

  throw lastError
}

export async function listItems({ fetchImpl = fetch } = {}) {
  const items = []
  const limit = 100
  let offset = 0

  while (true) {
    const page = await request(
      `/collections/${COLLECTION_ID}/items?limit=${limit}&offset=${offset}`,
      { fetchImpl }
    )
    items.push(...(page.items ?? []))

    const total = page.pagination?.total ?? items.length
    offset += limit
    if (items.length >= total || (page.items ?? []).length === 0) break
  }

  return items
}

export async function createItems(fieldDataList, { fetchImpl = fetch } = {}) {
  if (fieldDataList.length === 0) return
  await request(`/collections/${COLLECTION_ID}/items`, {
    method: 'POST',
    body: { items: fieldDataList.map((fieldData) => ({ fieldData })) },
    fetchImpl,
  })
}

export async function updateItems(updates, { fetchImpl = fetch } = {}) {
  if (updates.length === 0) return
  await request(`/collections/${COLLECTION_ID}/items`, {
    method: 'PATCH',
    body: {
      items: updates.map(({ itemId, fieldData }) => ({
        id: itemId,
        isArchived: false,
        isDraft: false,
        fieldData,
      })),
    },
    fetchImpl,
  })
}

export async function publishItems(itemIds, { fetchImpl = fetch } = {}) {
  if (itemIds.length === 0) return
  await request(`/collections/${COLLECTION_ID}/items/publish`, {
    method: 'POST',
    body: { itemIds },
    fetchImpl,
  })
}

// Arquivar = tirar do ar e marcar isArchived. NUNCA deletar: delete na Data API
// e irreversivel, e o efeito para o visitante e identico.
export async function archiveItems(itemIds, { fetchImpl = fetch } = {}) {
  if (itemIds.length === 0) return

  const query = itemIds.map((id) => `itemIds=${encodeURIComponent(id)}`).join('&')
  await request(`/collections/${COLLECTION_ID}/items/live?${query}`, {
    method: 'DELETE',
    fetchImpl,
  })

  await request(`/collections/${COLLECTION_ID}/items`, {
    method: 'PATCH',
    body: { items: itemIds.map((id) => ({ id, isArchived: true, isDraft: true })) },
    fetchImpl,
  })
}
```

- [ ] **Step 2: Verificar a leitura contra a API real**

Run: `WEBFLOW_TOKEN=<token> node -e "import('./src/webflow.js').then(async m => { const i = await m.listItems(); console.log(i.length, 'itens'); })"`
Expected: `22 itens` (ou o total corrente). Nenhuma escrita.

- [ ] **Step 3: Commit**

```bash
git add src/webflow.js
git commit -m "feat: cliente da Data API v2 do Webflow com retry"
```

---

### Task 5: `index.js` (orquestrador, DRY_RUN, summary e state)

**Files:**
- Create: `src/index.js`
- Create: `state/.gitkeep`

**Interfaces:**
- Consumes: `fetchJobs` (Task 3), `toFieldData` (Task 1), `buildPlan`/`assertArchiveLimit`/`isEmptyPlan` (Task 2), `listItems`/`createItems`/`updateItems`/`publishItems`/`archiveItems` (Task 4)
- Produces: executável `node src/index.js`. Variáveis de ambiente: `WEBFLOW_TOKEN` (obrigatória fora de DRY_RUN), `DRY_RUN=1`, `FORCE=1`

- [ ] **Step 1: Implementar `src/index.js`**

```js
import { writeFile, appendFile, mkdir } from 'node:fs/promises'
import { fetchJobs } from './ashby.js'
import { toFieldData } from './transform.js'
import { buildPlan, assertArchiveLimit, isEmptyPlan } from './reconcile.js'
import { listItems, createItems, updateItems, publishItems, archiveItems } from './webflow.js'

const DRY_RUN = process.env.DRY_RUN === '1'
const FORCE = process.env.FORCE === '1'

function renderPlan(plan) {
  const lines = []
  for (const fieldData of plan.create) lines.push(`  CRIAR      ${fieldData.name}`)
  for (const { fieldData } of plan.update) lines.push(`  ATUALIZAR  ${fieldData.name}`)
  for (const { name } of plan.archive) lines.push(`  ARQUIVAR   ${name}`)
  lines.push(`  (sem mudanca: ${plan.unchanged.length})`)
  return lines.join('\n')
}

async function writeSummary(plan) {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (!path) return
  const summary =
    `### Sync Ashby -> Webflow\n\n` +
    `| acao | qtd |\n| --- | --- |\n` +
    `| criadas | ${plan.create.length} |\n` +
    `| atualizadas | ${plan.update.length} |\n` +
    `| arquivadas | ${plan.archive.length} |\n` +
    `| sem mudanca | ${plan.unchanged.length} |\n\n` +
    (isEmptyPlan(plan) ? '' : '```\n' + renderPlan(plan) + '\n```\n')
  await appendFile(path, summary)
}

// So grava state quando houve mudanca: commitar em toda rodada geraria ~8.640
// commits de ruido por mes.
async function writeState(plan) {
  if (isEmptyPlan(plan)) return
  await mkdir('state', { recursive: true })
  await writeFile(
    'state/last-sync.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        criadas: plan.create.map((f) => f.name),
        atualizadas: plan.update.map((u) => u.fieldData.name),
        arquivadas: plan.archive.map((a) => a.name),
        semMudanca: plan.unchanged.length,
      },
      null,
      2
    ) + '\n'
  )
}

async function apply(plan) {
  await createItems(plan.create)
  await updateItems(plan.update)

  // Recarrega para descobrir os IDs dos itens recem-criados, que o plano nao tem.
  const itemsAfter = await listItems()
  const ativos = new Set(plan.create.map((f) => f['ashby-job-id']))
  const idsCriados = itemsAfter
    .filter((item) => ativos.has(item.fieldData?.['ashby-job-id']))
    .map((item) => item.id)

  await publishItems([...idsCriados, ...plan.update.map((u) => u.itemId)])
  await archiveItems(plan.archive.map((a) => a.itemId))
}

async function main() {
  const jobs = await fetchJobs()
  const desired = jobs.map(toFieldData)
  const items = await listItems()
  const plan = buildPlan(desired, items)

  console.log(`Ashby: ${jobs.length} vagas | CMS: ${items.length} itens`)
  console.log(renderPlan(plan))

  assertArchiveLimit(plan, { force: FORCE })

  if (DRY_RUN) {
    console.log('\nDRY_RUN=1 — nada foi escrito.')
    await writeSummary(plan)
    return
  }

  if (isEmptyPlan(plan)) {
    console.log('\nNada a fazer.')
    await writeSummary(plan)
    return
  }

  await apply(plan)
  await writeSummary(plan)
  await writeState(plan)
  console.log('\nAplicado.')
}

main().catch((error) => {
  console.error(`\nFALHOU: ${error.message}`)
  process.exitCode = 1
})
```

- [ ] **Step 2: Criar `state/.gitkeep`**

```bash
mkdir -p state && touch state/.gitkeep
```

- [ ] **Step 3: Rodar a suíte completa**

Run: `node --test`
Expected: PASS — 28 testes, 0 falhas

- [ ] **Step 4: Commit**

```bash
git add src/index.js state/.gitkeep
git commit -m "feat: orquestrador com DRY_RUN, summary e state"
```

---

### Task 6: Workflows do GitHub Actions e README

**Files:**
- Create: `.github/workflows/sync.yml`
- Create: `.github/workflows/heartbeat.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: `node src/index.js` (Task 5); secret `WEBFLOW_TOKEN`
- Produces: cron `*/5`, botão `workflow_dispatch` com opções `dry_run` e `force`, gatilho `repository_dispatch` do tipo `sync`

- [ ] **Step 1: Criar `.github/workflows/sync.yml`**

```yaml
name: sync

on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'So mostrar o plano, sem escrever'
        type: boolean
        default: false
      force:
        description: 'Ignorar a guarda de arquivamento em massa'
        type: boolean
        default: false
  repository_dispatch:
    types: [sync]

permissions:
  contents: write

# Duas rodadas simultaneas brigariam pela mesma collection.
concurrency:
  group: sync
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: node --test

      - name: Sincronizar
        env:
          WEBFLOW_TOKEN: ${{ secrets.WEBFLOW_TOKEN }}
          DRY_RUN: ${{ inputs.dry_run && '1' || '0' }}
          FORCE: ${{ inputs.force && '1' || '0' }}
        run: node src/index.js

      - name: Commitar state, se mudou
        run: |
          if [ -n "$(git status --porcelain state/)" ]; then
            git config user.name 'nirvana-careers-sync'
            git config user.email 'actions@github.com'
            git add state/
            git commit -m "chore: state do sync [skip ci]"
            git push
          fi
```

- [ ] **Step 2: Criar `.github/workflows/heartbeat.yml`**

```yaml
# O GitHub desativa cron de repositorio sem atividade ha 60 dias. O sync so commita
# quando ha mudanca, entao um periodo calmo poderia matar o agendamento.
name: heartbeat

on:
  schedule:
    - cron: '0 6 1 * *'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  heartbeat:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          date -u +'%Y-%m-%dT%H:%M:%SZ' > state/heartbeat.txt
          git config user.name 'nirvana-careers-sync'
          git config user.email 'actions@github.com'
          git add state/heartbeat.txt
          git commit -m "chore: heartbeat [skip ci]"
          git push
```

- [ ] **Step 3: Criar `README.md`**

```markdown
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
node --test                                  # testes, sem rede
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
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/sync.yml .github/workflows/heartbeat.yml README.md
git commit -m "ci: cron de 5 minutos, heartbeat mensal e README"
```

---

### Task 7: Primeira execução — dry run, revisão humana e go-live

**Files:**
- Nenhum arquivo novo. Esta task é verificação contra produção.

**Interfaces:**
- Consumes: tudo das Tasks 1-6

- [ ] **Step 1: Rodar o dry run contra os dados reais**

Run: `DRY_RUN=1 WEBFLOW_TOKEN=<token> node src/index.js`

Expected — com o estado de 2026-07-27 (4 vagas no Ashby, 22 itens na CMS):
```
Ashby: 4 vagas | CMS: 22 itens
  ATUALIZAR  Sr Manager, Corporate Development
  ARQUIVAR   Manager, Underwriting Strategy & Operations
  (sem mudanca: 3)

DRY_RUN=1 — nada foi escrito.
```

Se o plano vier diferente disso, **pare** e investigue antes de aplicar. Divergência
aqui significa que uma regra derivada não bate com o que já está na CMS, e aplicar
sobrescreveria dados sem querer.

- [ ] **Step 2: Revisar o plano com o dono do projeto**

Não prossiga sem aprovação explícita. Esta é a primeira escrita em uma CMS de
produção de cliente.

- [ ] **Step 3: Aplicar de verdade**

Run: `WEBFLOW_TOKEN=<token> node src/index.js`
Expected: `Aplicado.`

- [ ] **Step 4: Verificar o resultado na página publicada**

Run: `curl -s https://careers.nirvanatech.com/jobs | grep -o 'jobs.ashbyhq.com/nirvana/[0-9a-f-]*' | sort -u`
Expected: exatamente os 4 IDs do board do Ashby, e nenhum a mais.

- [ ] **Step 5: Confirmar idempotência**

Run: `WEBFLOW_TOKEN=<token> node src/index.js`
Expected: `Nada a fazer.` — se a segunda rodada seguida ainda propuser mudanças, há
um campo cuja normalização está errada. Investigue antes de ligar o cron; senão o
sync vai reescrever os mesmos itens a cada 5 minutos.

- [ ] **Step 6: Criar o repo e ligar o cron**

```bash
gh repo create Nirvana-mkt-design/nirvana-careers-sync --public --source=. --push
```

Depois, no GitHub: Settings → Secrets and variables → Actions → New repository secret
→ `WEBFLOW_TOKEN`. **Gere um token novo** para isso; não reutilize o que circulou em
chat.

- [ ] **Step 7: Validar a primeira execução agendada**

Aguarde um ciclo do cron e confira em Actions que o run terminou verde com
`sem mudanca: 4`.

- [ ] **Step 8: Revogar credenciais antigas**

No Webflow: revogar o site token que circulou em chat e o workspace token. Conferir
que sobrou apenas o token novo do GitHub Secret (o site aceita no máximo 5).

---

## Pendências fora deste plano

1. **Taxonomia do filtro "Teams"** — decisão do recruiting, documentada na spec como
   não-objetivo.
2. **Revogar as conexões Zapier e make** no Webflow (Connected Apps, ambas em "Action
   needed"). Se alguém reconectar o Zapier, passa a haver dois escritores na mesma
   collection. Fazer no go-live.
