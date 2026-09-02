# BenchmarkRunner

Compara la latencia de **Firestore** y **MongoDB** en operaciones habituales sobre
documentos. Las mediciones son reales: se ejecutan en el servidor contra las bases de
datos configuradas y se transmiten al navegador en vivo.

## Arquitectura

El dominio define un único puerto y todo lo demás lo implementa:

```ts
export type BenchmarkRunner = {
  readonly run: (config: BenchmarkConfig, signal: AbortSignal) => AsyncIterable<RunEvent>
}
```

```
navegador                          servidor
─────────                          ────────
BenchmarkConsole
  └─ HttpBenchmarkRunner ──SSE──▶  /api/benchmark
       (implementa el puerto)         └─ FirestoreRunner ──▶ Firestore
                                      └─ (MongoRunner)   ──▶ Atlas
```

La isla de UI solo conoce el tipo del puerto. Cambiar de adaptador simulado a adaptador
real fue una línea en el *composition root*. Ningún SDK de base de datos llega al bundle
del cliente: `firebase-admin` vive únicamente en `src/server/`.

| Carpeta | Responsabilidad |
|---|---|
| `src/benchmark/domain/` | Tipos, validación, percentiles, reducer de estado. No importa nada hacia afuera. |
| `src/benchmark/adapters/` | Implementaciones del puerto: mock, Firestore, HTTP. |
| `src/benchmark/ui/` | Web Component, tablas, gráfico y todos los textos. |
| `src/server/` | Credenciales y clientes de base de datos. Solo servidor. |
| `src/pages/api/` | Endpoint SSE. Valida la entrada de red antes de tocar nada. |

## Desarrollo

```bash
npm install
cp .env.example .env      # y completar
npm run dev
```

Verificación de configuración antes de arrancar:

```bash
node scripts/check-env.mjs               # forma del .env, expande y parsea la llave PEM
node scripts/check-firestore.mjs         # conecta de verdad (solo lectura)
node scripts/check-firestore-location.mjs # región y tipo de la base
```

Para cargar una service account de Google sin copiar la llave a mano:

```bash
node scripts/import-service-account.mjs ruta/al/key.json --write
```

## Despliegue en Vercel

El proyecto usa `@astrojs/vercel`; Vercel detecta Astro automáticamente. Dos ajustes que
**no** son opcionales:

- **`regions: ["iad1"]`** en `vercel.json` — la función serverless es la que mide. Si
  Vercel la ubica lejos de la región de la base de datos, cada muestra incluye esa
  distancia y el benchmark deja de medir la base para medir la topología.
- **`maxDuration: 300` en el adaptador**, dentro de `astro.config.mjs`. Va ahí y no en el
  bloque `functions` de `vercel.json`: el adaptador emite **una sola** función para todas
  las rutas (`_render.func`), así que un patrón por archivo no matchea nada y rompe el
  build. Una corrida completa son 200 iteraciones × 5 operaciones × 2 motores, unos 162 s
  con las latencias medidas; con un techo de 60 s el reporte se truncaba sin avisar.

### Variables de entorno

Cargarlas en *Project Settings → Environment Variables*. Ninguna lleva prefijo `PUBLIC_`,
así que **ninguna llega al navegador**.

| Variable | De dónde sale |
|---|---|
| `FIRESTORE_PROJECT_ID` | JSON de la service account |
| `FIRESTORE_CLIENT_EMAIL` | JSON de la service account |
| `FIRESTORE_PRIVATE_KEY` | JSON de la service account, con los `\n` literales |
| `FIRESTORE_REGION` | Consola de Firestore |
| `MONGODB_URI` | Atlas → Connect → Drivers |
| `MONGODB_DB` | Nombre de la base |
| `BENCH_MAX_ITERATIONS` | Techo del servidor, independiente de lo que pida la UI |

La llave privada se pega **con los `\n` literales**, tal como aparece en el JSON. El
servidor los expande al arrancar.

## Cómo leer los resultados

- **p95, no la media.** El ganador se decide por cola de latencia, que es lo que un
  usuario percibe.
- **Escala logarítmica** en el gráfico: si un motor tarda 40 ms y otro 2 ms, en escala
  lineal el segundo es una raya invisible.
- **Latencia y rendimiento son preguntas distintas.** Con concurrencia mayor a 1 la
  latencia individual empeora por contención mientras el rendimiento agregado sube; la
  columna *Rendimiento* usa el reloj de pared de la fase, no la inversa de la media.
- Una base Firestore en una **multirregión** (`nam5`) replica cada escritura entre
  regiones antes de confirmarla. Comparar eso contra un cluster de región única no mide
  solo el motor.

Cada fase crea su propia colección temporal y la elimina al terminar, incluso si falla.
