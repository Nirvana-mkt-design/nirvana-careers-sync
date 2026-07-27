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
  if (payload.jobs.length === 0) {
    throw new Error('Ashby devolveu zero vagas. Abortando sem tocar no Webflow.')
  }

  return payload.jobs
}
