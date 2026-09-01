#!/usr/bin/env node
// Validates .env locally: shape, PEM expansion, and a real crypto parse.
// Never prints secret material — only lengths, shapes and a short fingerprint.

import { readFileSync, existsSync } from 'node:fs'
import { createPrivateKey } from 'node:crypto'
import { resolve } from 'node:path'

const envPath = resolve(process.cwd(), '.env')
if (!existsSync(envPath)) {
  console.error('No .env found. Copy .env.example and fill it in.')
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

let failed = 0
const report = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed += 1
}

console.log('\nFirestore')
const projectId = read('FIRESTORE_PROJECT_ID')
const clientEmail = read('FIRESTORE_CLIENT_EMAIL')
const rawKey = read('FIRESTORE_PRIVATE_KEY')
const region = read('FIRESTORE_REGION')

report('FIRESTORE_PROJECT_ID', projectId !== null, projectId ?? 'ausente')
report(
  'FIRESTORE_CLIENT_EMAIL',
  clientEmail !== null && clientEmail.endsWith('.iam.gserviceaccount.com'),
  clientEmail === null ? 'ausente' : '…' + clientEmail.slice(-30),
)
report('FIRESTORE_REGION', region !== null, region ?? 'ausente — hace falta para comparar con Atlas')

if (rawKey === null) {
  report('FIRESTORE_PRIVATE_KEY', false, 'ausente')
} else {
  const hasEscaped = rawKey.includes('\\n')
  const hasReal = rawKey.includes('\n')
  const pem = hasEscaped ? rawKey.split('\\n').join('\n') : rawKey
  const lines = pem.split('\n').filter((l) => l.length > 0)

  console.log(`  info  longitud ${rawKey.length} · \\n escapados: ${hasEscaped} · saltos reales: ${hasReal}`)
  report('cabecera PEM', pem.startsWith('-----BEGIN PRIVATE KEY-----'))
  report('cierre PEM', pem.trimEnd().endsWith('-----END PRIVATE KEY-----'))
  report('estructura multilinea', lines.length > 2, `${lines.length} líneas`)

  try {
    const key = createPrivateKey(pem)
    const bits = key.asymmetricKeyDetails?.modulusLength
    report('parseo criptográfico', true, `${key.asymmetricKeyType.toUpperCase()} ${bits ?? '?'} bits`)
  } catch (error) {
    report('parseo criptográfico', false, error instanceof Error ? error.message : String(error))
  }
}

console.log('\nMongoDB')
const uri = read('MONGODB_URI')
const db = read('MONGODB_DB')
report(
  'MONGODB_URI',
  uri !== null && /^mongodb(\+srv)?:\/\//.test(uri),
  uri === null ? 'ausente' : uri.replace(/\/\/[^@]+@/, '//***:***@').slice(0, 48) + '…',
)
if (uri !== null && uri.includes('<password>')) {
  report('contraseña reemplazada', false, 'la URI todavía tiene el marcador <password>')
}
report('MONGODB_DB', db !== null, db ?? 'ausente')

console.log(failed === 0 ? '\nTodo listo.\n' : `\n${failed} problema(s).\n`)
process.exit(failed === 0 ? 0 : 1)
