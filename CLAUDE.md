# BenchmarkRunner — contexto del proyecto

Compara latencia real de **Firestore** y **MongoDB**. Las mediciones se ejecutan en el
servidor contra bases reales y se transmiten al navegador por SSE.

## La regla que gobierna todo

El dominio define **un puerto**, y todo lo demás lo implementa:

```ts
// src/benchmark/domain/benchmark-runner.ts
export type BenchmarkRunner = {
  readonly run: (config: BenchmarkConfig, signal: AbortSignal) => AsyncIterable<RunEvent>
}
```

La isla de UI **solo conoce ese tipo**. Cambiar del adaptador simulado al real de Firestore
fue una línea en el composition root (`src/pages/index.astro`). Si algún cambio obliga a
tocar la UI para agregar un motor, el diseño se rompió.

**`run` usa sintaxis de propiedad, no de método.** `strictFunctionTypes` no aplica a los
métodos abreviados: un adaptador con parámetros más angostos compilaría igual. No revertir
a `run(config, signal): ...`.

## Invariantes que no se negocian

| Invariante | Cómo verificarlo |
|---|---|
| `domain/` no importa hacia afuera | `grep -rnE "from '\.\./(ui\|adapters)" src/benchmark/domain/` → vacío |
| `ui/` no importa adaptadores | `grep -rn "adapters/" src/benchmark/ui/` → vacío |
| Ningún SDK de base de datos en el bundle cliente | `firebase-admin` solo en `src/server/` y `adapters/firestore-runner.ts`, ambos importados únicamente desde `src/pages/api/` |
| El dominio no habla ningún idioma | emite códigos (`ConfigViolation`), la UI los traduce en `src/benchmark/ui/copy.ts` |
| La entrada de red se valida elemento por elemento | `isEngineId` / `isOperationId` en `src/pages/api/benchmark.ts` |

## Decisiones y su porqué

- **El ganador se decide por p95, no por la media.** La cola es lo que el usuario siente.
- **El gráfico usa escala logarítmica.** Firestore ~200 ms contra Mongo ~2 ms: en escala
  lineal el segundo es una raya invisible.
- **La columna Rendimiento usa `wallClockMs` de la fase, no `summary.opsPerSecond`.**
  Ese último es la inversa de la media y **se invierte** al subir la concurrencia: medido,
  concurrency 1→6 bajaba de 6.47 a 3.67 op/s reportados mientras el rendimiento real subía
  de 5.65 a 19.9. Latencia y rendimiento son preguntas distintas; nunca derivar una de la otra.
- **`deleteOne` siembra `iterations + warmup` documentos.** Con solo `iterations`, el
  calentamiento consume los primeros y la medición vuelve a borrarlos: Firestore no falla
  al borrar algo inexistente, así que `errorCount` queda en 0 y los números salen limpios
  y falsos.
- **Locale `es-HN`, no `es`.** `es`/`es-ES` usan coma decimal (`42,18`); `es-HN` mantiene
  el punto. Único punto de cambio: `LOCALE` en `src/benchmark/ui/format.ts`.
- **Firestore vive en `nam5`, que es multirregión.** Cada escritura replica entre regiones
  de EE. UU. antes de confirmarse. No es comparable contra un cluster de región única sin
  declararlo. La UI lo dice en el banner.

## Estructura

| Carpeta | Responsabilidad |
|---|---|
| `src/benchmark/domain/` | Tipos, validación, percentiles, reducer. Cero dependencias hacia afuera. |
| `src/benchmark/adapters/` | Implementaciones del puerto: `mock`, `firestore` (servidor), `http` (cliente). |
| `src/benchmark/ui/` | Web Component vanilla, tabla, gráfico SVG, y **todos** los textos en `copy.ts`. |
| `src/server/` | Credenciales y clientes. Solo servidor, nunca importado desde `ui/`. |
| `src/pages/api/` | Endpoint SSE. Valida entrada y despacha por motor. |

Sin framework de UI: Web Components y TypeScript. Tailwind v4 con tokens en
`src/styles/global.css` (`@theme inline`). Tipografía: Unbounded solo en el `h1`, Inter
para UI, Martian Mono para datos.

## Cómo verificar

```bash
npx astro check          # 0 errores esperados
npm run build            # debe pasar
node scripts/check-env.mjs                 # forma del .env + parseo criptográfico de la llave
node scripts/check-firestore.mjs           # conecta de verdad, solo lectura
node scripts/check-firestore-location.mjs  # región y tipo de la base
```

No existe runner de tests en el repo. Hay un script de verificación del dominio
(32 aserciones: percentiles, validación, determinismo, cancelación) que vivía en el
scratchpad; si hace falta de nuevo, se reescribe o se instala vitest.

Servidor de desarrollo en segundo plano: `astro dev --background`, y se maneja con
`astro dev stop|status|logs`.

## Estado actual

- Firestore: **funcionando** contra el proyecto real. `findById` p50 ~200 ms desde Honduras.
- MongoDB: **sin cablear**. El endpoint responde `engine-not-wired`. `ENGINE_RUNNERS` en
  `src/pages/api/benchmark.ts` es un `Record<EngineId, Factory | null>`: **no compila**
  hasta enumerar todo motor nuevo, y el despacho sale de esa misma tabla.
- Multi-motor en una sola corrida: rechazado explícitamente (`multi-engine-not-implemented`).
- Ramas: `feature/*` → `development` → PR → `main`. `main` no acepta push directo.

## Credenciales

Nunca en el repo. `.env` está ignorado; `.env.example` documenta cada variable.
`FIRESTORE_PRIVATE_KEY` se guarda con los `\n` **literales** y el servidor los expande al
arrancar. Para cargar una service account sin copiarla a mano:

```bash
node scripts/import-service-account.mjs ruta/al/key.json --write
```
