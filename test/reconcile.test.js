import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan, assertArchiveLimit, assertUnpublishLimit, isEmptyPlan } from '../src/reconcile.js'

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

// --- Fantasmas: itens vivos no site que o staged nao explica ---
//
// O bug do card duplicado da Corp Dev (2026-08-04): o staged tinha UM item da vaga,
// o site mostrava DOIS. O segundo so existia na lista live. Reconciliar so contra o
// staged nao consegue nem enxergar esse item, muito menos tirar do ar.

test('item vivo que nao existe no staged entra em unpublish', () => {
  const plan = buildPlan([fd('a')], [item('item-1', fd('a'))], [
    item('item-1', fd('a')),
    item('fantasma', fd('a', { department: 'R&D' })),
  ])
  assert.equal(plan.unpublish.length, 1)
  assert.equal(plan.unpublish[0].itemId, 'fantasma')
  assert.equal(plan.archive.length, 0)
})

test('item vivo cuja vaga sumiu do Ashby entra em unpublish mesmo estando arquivado no staged', () => {
  // Este e o estado exato que o `if (item.isArchived) continue` deixava passar:
  // arquivado no staged (logo, ignorado) mas ainda publicado no site.
  const plan = buildPlan([], [item('item-1', fd('a'), { isArchived: true })], [item('item-1', fd('a'))])
  assert.equal(plan.archive.length, 0)
  assert.equal(plan.unpublish.length, 1)
  assert.equal(plan.unpublish[0].itemId, 'item-1')
})

test('item vivo que corresponde a vaga aberta nao entra em unpublish', () => {
  const plan = buildPlan([fd('a')], [item('item-1', fd('a'))], [item('item-1', fd('a'))])
  assert.equal(plan.unpublish.length, 0)
  assert.deepEqual(plan.unchanged, ['item-1'])
})

test('item que ja vai ser arquivado nao aparece tambem em unpublish', () => {
  // archiveItems ja despublica antes de arquivar. Listar nos dois lugares faria
  // a mesma chamada duas vezes.
  const plan = buildPlan([], [item('item-1', fd('a'))], [item('item-1', fd('a'))])
  assert.equal(plan.archive.length, 1)
  assert.equal(plan.unpublish.length, 0)
})

test('sem lista live o plano continua valido e sem unpublish', () => {
  const plan = buildPlan([fd('a')], [item('item-1', fd('a'))])
  assert.deepEqual(plan.unpublish, [])
})

test('isEmptyPlan considera unpublish', () => {
  assert.equal(isEmptyPlan({ create: [], update: [], archive: [], unpublish: [{}], unchanged: [] }), false)
})

test('assertUnpublishLimit aborta acima de 5 e libera com force', () => {
  const plan = { unpublish: Array.from({ length: 6 }, (_, i) => ({ itemId: `i${i}`, name: `n${i}` })) }
  assert.throws(() => assertUnpublishLimit(plan), /despublicar 6/)
  assert.doesNotThrow(() => assertUnpublishLimit(plan, { force: true }))
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
