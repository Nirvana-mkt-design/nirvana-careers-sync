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
  const criados = new Set(plan.create.map((f) => f['ashby-job-id']))
  const idsCriados = itemsAfter
    .filter((item) => criados.has(item.fieldData?.['ashby-job-id']))
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
