export const SITE_ID = '68481a33ab03304a33c6c1c9'
export const COLLECTION_ID = '684c6540b149c4126f1c3502'
export const ASHBY_BOARD_URL = 'https://api.ashbyhq.com/posting-api/job-board/nirvana'
export const WEBFLOW_API = 'https://api.webflow.com/v2'

// Acima disso o sync aborta: arquivamento em massa quase sempre e falha de leitura.
export const MAX_ARCHIVE_PER_RUN = 5

// Os unicos campos que o sync gerencia. Comparacao e escrita se limitam a eles.
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
