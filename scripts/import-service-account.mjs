#!/usr/bin/env node
// Converts a Google service-account JSON into the .env lines this project needs.
// Usage: node scripts/import-service-account.mjs <path-to-key.json> [--write]

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , keyPath, ...flags] = process.argv
const write = flags.includes('--write')

if (!keyPath) {
  console.error('Usage: node scripts/import-service-account.mjs <path-to-key.json> [--write]')
  process.exit(1)
}

const resolved = resolve(keyPath)
if (!existsSync(resolved)) {
  console.error(`No such file: ${resolved}`)
  process.exit(1)
}

let key
try {
  key = JSON.parse(readFileSync(resolved, 'utf8'))
} catch (error) {
  console.error(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const missing = ['project_id', 'client_email', 'private_key'].filter((f) => !key[f])
if (missing.length > 0) {
  console.error(`Missing field(s) in the JSON: ${missing.join(', ')}`)
  console.error('Is this a service-account key, or an OAuth client / API key by mistake?')
  process.exit(1)
}

if (key.type !== 'service_account') {
  console.error(`Expected "type": "service_account", found: ${String(key.type)}`)
  process.exit(1)
}

// The JSON holds real newlines; .env needs them escaped back to the literal \n
// two-character sequence, which the server re-expands at startup.
const escapedKey = key.private_key.replace(/\n/g, '\\n')

const lines = [
  `FIRESTORE_PROJECT_ID=${key.project_id}`,
  `FIRESTORE_CLIENT_EMAIL=${key.client_email}`,
  `FIRESTORE_PRIVATE_KEY="${escapedKey}"`,
]

const fingerprint = `${key.private_key.slice(28, 40)}…` // never print the whole key

console.log(`\nService account: ${key.client_email}`)
console.log(`Project:         ${key.project_id}`)
console.log(`Key fingerprint: ${fingerprint}`)

if (!write) {
  console.log('\nAdd these lines to .env (or re-run with --write):\n')
  console.log(lines.join('\n'))
  console.log('')
  process.exit(0)
}

const envPath = resolve(process.cwd(), '.env')
const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''

if (/^FIRESTORE_PROJECT_ID=.+/m.test(existing)) {
  console.error('\n.env already has FIRESTORE_* values. Refusing to overwrite.')
  console.error('Remove them first, or paste the lines above by hand.')
  process.exit(1)
}

const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
appendFileSync(envPath, `${separator}${lines.join('\n')}\n`, 'utf8')
console.log(`\nAppended 3 FIRESTORE_* lines to ${envPath}`)
console.log('Still to fill in by hand: FIRESTORE_REGION, MONGODB_URI\n')
