#!/usr/bin/env node
// Connects to the configured MongoDB and reports the real latency floor.
// Read-only: it pings and reads metadata, it never writes.
// Usage: node --env-file=.env scripts/check-mongo.mjs

import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI
const dbName = process.env.MONGODB_DB

if (!uri) {
  console.error('MONGODB_URI ausente. Corré con: node --env-file=.env scripts/check-mongo.mjs')
  process.exit(1)
}

// Never print the URI: it carries the password.
const host = uri.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, '').split('/')[0]
console.log(`\nCluster:  ${host}`)
console.log(`Base:     ${dbName ?? '(sin MONGODB_DB)'}`)
console.log('Conectando…\n')

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })

try {
  const started = Date.now()
  await client.connect()
  const connectMs = Date.now() - started

  const admin = client.db().admin()

  // One ping is a single sample and says little. Take several and read the
  // median: that is the floor every benchmark number sits on top of.
  const samples = []
  for (let i = 0; i < 7; i += 1) {
    const at = Date.now()
    await admin.command({ ping: 1 })
    samples.push(Date.now() - at)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]

  const hello = await admin.command({ hello: 1 })
  const build = await admin.command({ buildInfo: 1 })

  console.log(`CONEXION OK — handshake + auth ${connectMs} ms`)
  console.log(`Ping x7:      ${samples.join(', ')} ms`)
  console.log(`Mediana:      ${median} ms  ← piso de latencia real`)
  console.log(`Servidor:     MongoDB ${build.version}`)
  console.log(`Replica set:  ${hello.setName ?? '(no informado)'}`)
  console.log(`Primario:     ${hello.primary ?? '(no informado)'}`)

  if (dbName !== undefined) {
    try {
      const db = client.db(dbName)
      const collections = await db.listCollections().toArray()
      console.log(`Colecciones en ${dbName}: ${collections.length}`)

      // An EMPTY _bench_ collection is expected: the adapter reuses a stable name
      // per operation and empties it, because dropping would take the index with
      // it. Only documents left behind mean a run died mid-phase.
      const bench = collections.filter((c) => c.name.startsWith('_bench_'))
      for (const collection of bench) {
        const count = await db.collection(collection.name).countDocuments({})
        const state = count === 0 ? 'vacia (normal)' : `${count} documento(s) — RESIDUO`
        console.log(`  ${collection.name}: ${state}`)
      }
    } catch (error) {
      console.log(`No se pudo listar ${dbName}: ${error.message}`)
    }
  }

  console.log('\nEse tiempo es tu piso de latencia real hacia el cluster.\n')
} catch (error) {
  console.error(`\nFALLA — ${error.message}`)
  if (/authentication failed/i.test(error.message)) {
    console.error('Usuario o contraseña incorrectos. Si la clave tiene @ : / ? #,')
    console.error('hay que percent-encodearla dentro de la URI.')
  }
  // Atlas rejects a non-allowlisted IP by killing the TLS handshake, not by
  // timing out. The OpenSSL text says nothing about it, so name it here.
  if (/tlsv1 alert|SSL alert number 80|ssl3_read_bytes/i.test(error.message)) {
    console.error('Atlas cortó el handshake TLS. Casi siempre significa que tu IP')
    console.error('NO está en Network Access, no que la contraseña esté mal.')
    console.error('Comprobalo: si el puerto 27017 abre por TCP pero TLS falla,')
    console.error('el cluster está vivo y te está rechazando por IP.')
  }
  if (/ETIMEDOUT|ServerSelection/i.test(error.message)) {
    console.error('El cluster no respondió. Puede estar pausado (un M0 se pausa')
    console.error('solo tras días de inactividad) o la red está bloqueada.')
  }
  process.exitCode = 1
} finally {
  await client.close()
}
