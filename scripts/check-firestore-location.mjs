#!/usr/bin/env node
// Read-only: asks the Firestore Admin API what this database actually is.
// Location, edition and concurrency mode all change how latency behaves.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { GoogleAuth } from 'google-auth-library'

const envPath = resolve(process.cwd(), '.env')
if (!existsSync(envPath)) {
  console.error('No .env found.')
  process.exit(1)
}

const env = readFileSync(envPath, 'utf8')
const read = (name) => {
  const match = env.match(new RegExp(`^${name}=(.*)$`, 'm'))
  if (!match) return null
  let value = match[1].trim()
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
  return value.length > 0 ? value : null
}

const projectId = read('FIRESTORE_PROJECT_ID')
const clientEmail = read('FIRESTORE_CLIENT_EMAIL')
const privateKey = read('FIRESTORE_PRIVATE_KEY')?.split('\\n').join('\n')

const auth = new GoogleAuth({
  credentials: { client_email: clientEmail, private_key: privateKey },
  scopes: ['https://www.googleapis.com/auth/datastore'],
})

const client = await auth.getClient()
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases`

try {
  const { data } = await client.request({ url })
  const databases = data.databases ?? []

  console.log(`\nBases en el proyecto ${projectId}: ${databases.length}\n`)
  for (const db of databases) {
    const name = db.name.split('/').pop()
    console.log(`  nombre:      ${name === '(default)' ? '(default)' : name}`)
    console.log(`  locationId:  ${db.locationId}`)
    console.log(`  type:        ${db.type}`)
    console.log(`  concurrency: ${db.concurrencyMode ?? 'n/d'}`)
    if (db.pointInTimeRecoveryEnablement) {
      console.log(`  PITR:        ${db.pointInTimeRecoveryEnablement}`)
    }
    console.log('')
  }
  process.exit(0)
} catch (error) {
  const message = error?.response?.data?.error?.message ?? error?.message ?? String(error)
  console.error(`\nNo se pudo consultar: ${message}\n`)
  if (String(message).includes('permission')) {
    console.error('El rol "Cloud Datastore User" no alcanza para leer metadatos de la base.')
    console.error('No es bloqueante: la region la podes leer en la consola web.\n')
  }
  process.exit(1)
}
