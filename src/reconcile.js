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
