#!/usr/bin/env node
// Read-only connectivity probe: authenticates and lists root collections.
// Writes nothing. Confirms the credentials AND the IAM role actually work.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

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

if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIRESTORE_* values in .env')
  process.exit(1)
}

console.log(`\nProyecto: ${projectId}`)
console.log(`Cuenta:   …${clientEmail.slice(-30)}`)
console.log('Conectando…\n')

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
const db = getFirestore()

const started = Date.now()
try {
  const collections = await db.listCollections()
  const elapsed = Date.now() - started

  console.log(`CONEXION OK — ${elapsed} ms`)
  console.log(`Colecciones en la raiz: ${collections.length}`)
  for (const collection of collections.slice(0, 10)) {
    console.log(`  · ${collection.id}`)
  }
  if (collections.length === 0) {
    console.log('  (base vacia — normal en un proyecto nuevo)')
  }
  console.log(`\nEse tiempo es tu piso de latencia real hacia la region.\n`)
  process.exit(0)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`FALLO tras ${Date.now() - started} ms`)
  console.error(`  ${message}\n`)

  if (message.includes('NOT_FOUND') || message.includes('does not exist')) {
    console.error('Pista: la base Firestore quiza no fue creada todavia.')
    console.error('       Console > Firestore > Create Database (modo Native).')
  } else if (message.includes('PERMISSION_DENIED') || message.includes('Missing or insufficient')) {
    console.error('Pista: a la service account le falta el rol "Cloud Datastore User".')
  } else if (message.includes('invalid_grant') || message.includes('DECODER')) {
    console.error('Pista: la llave privada no se expandio bien desde .env.')
  }
  process.exit(1)
}
