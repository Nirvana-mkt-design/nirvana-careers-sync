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
