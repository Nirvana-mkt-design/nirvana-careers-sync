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
