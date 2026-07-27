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
