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

  // O unpublish quer os itens no BODY (`items`), nao em query string.
  await request(`/collections/${COLLECTION_ID}/items/live`, {
    method: 'DELETE',
    body: { items: itemIds.map((id) => ({ id })) },
    fetchImpl,
  })

  await request(`/collections/${COLLECTION_ID}/items`, {
    method: 'PATCH',
    body: { items: itemIds.map((id) => ({ id, isArchived: true, isDraft: true })) },
    fetchImpl,
  })
}
