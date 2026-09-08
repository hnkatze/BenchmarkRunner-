# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# BenchmarkRunner — contexto del proyecto

Compara latencia real de **Firestore** y **MongoDB**. Las mediciones se ejecutan en el
servidor contra bases reales y se transmiten al navegador por SSE.

Astro 7 + TypeScript estricto + Tailwind v4. **Sin framework de UI**: Web Components
vanilla. Node `>=22.12.0` (`engines` en `package.json`).

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
| `domain/` no importa hacia afuera | `rg -n "from '\.\./(ui\|adapters)" src/benchmark/domain/` → vacío |
| `ui/` no importa adaptadores | `rg -n "adapters/" src/benchmark/ui/` → vacío |
| Ningún SDK de base de datos en el bundle cliente | `firebase-admin` y `mongodb` solo en `src/server/` y en sus adaptadores, importados únicamente desde `src/pages/api/`. Verificar sobre el bundle construido buscando **señales del SDK** (`MongoClient`, `initializeApp`, `google-gax`, `bson`), **nunca** la palabra `mongodb`: es un `EngineId`, una clave de icono y una etiqueta, así que siempre da falso positivo |
| El dominio no habla ningún idioma | emite códigos (`ConfigViolation`), la UI los traduce en `src/benchmark/ui/copy.ts` |
| La entrada de red se valida elemento por elemento | `isEngineId` / `isOperationId` en `src/pages/api/benchmark.ts` |

Excepción deliberada: `adapters/http-benchmark-runner.ts` importa `ui/copy.ts` para los
mensajes de transporte. Es un adaptador de cliente y los textos siguen viviendo en un solo
lugar.

## Tablas totales: el patrón que se repite

Cinco lugares usan la misma técnica — **una tabla indexada por el tipo, para que agregar un
miembro rompa la compilación en vez de fallar en runtime**. Al extender cualquier unión,
buscar sus tablas:

| Tabla | Archivo | Rompe si agregás… |
|---|---|---|
| `ENGINE_RUNNERS: Record<EngineId, EngineFactory \| null>` | `src/pages/api/benchmark.ts` | un `EngineId` |
| `FIELD_LABELS: Record<keyof BenchmarkConfig, string>` | `src/benchmark/ui/copy.ts` | un campo a `BenchmarkConfig` |
| `ENGINE_DISPLAY` / `OPERATION_DISPLAY` | `src/benchmark/ui/labels.ts` | un motor o una operación |
| `RUN_EVENT_TYPES` + el centinela `MissingEventType` | `src/benchmark/domain/run-event.ts` | una variante a `RunEvent` |
| `switch` sobre uniones | dominio y adaptadores | cualquier variante — el `default` hace `const unhandled: never` |

`satisfies` por sí solo **no** detecta miembros faltantes; por eso el centinela
`MissingEventType` existe. No borrarlo por "código muerto".

## Decisiones y su porqué

- **El ganador se decide por p95, no por la media.** La cola es lo que el usuario siente.
  Un empate exacto o un motor único no dan ganador (`compareByOperation`).
- **El gráfico usa escala logarítmica.** Firestore ~200 ms contra Mongo ~2 ms: en escala
  lineal el segundo es una raya invisible.
- **La columna Rendimiento usa `wallClockMs` de la fase, no `summary.opsPerSecond`.**
  Ese último es la inversa de la media y **se invierte** al subir la concurrencia: medido,
  concurrency 1→6 bajaba de 6.47 a 3.67 op/s reportados mientras el rendimiento real subía
  de 5.65 a 19.9. Latencia y rendimiento son preguntas distintas; nunca derivar una de la
  otra. El helper correcto es `throughputOpsPerSecond(result)`.
- **`deleteOne` siembra `iterations + warmup` documentos.** Con solo `iterations`, el
  calentamiento consume los primeros y la medición vuelve a borrarlos: Firestore no falla
  al borrar algo inexistente, así que `errorCount` queda en 0 y los números salen limpios
  y falsos. El calentamiento corre en índices `iterations + i` justamente para no solaparse.
- **Cada operación tiene su colección dedicada `_bench_<operation>`, y se vacía al entrar
  y al salir de la fase.** El nombre es **estable a propósito**: un índice compuesto en
  Firestore se define por colección, así que un nombre con timestamp exigiría crear el
  índice otra vez en cada corrida — por eso `queryFiltered` fallaba. El índice sobrevive a
  una colección vacía, de modo que vaciar alcanza para no dejar datos.
  Se vacía **también al entrar**, porque una corrida cortada a la mitad (`maxDuration`,
  una caída) deja documentos y la siembra siguiente mediría contra una colección sucia.
  En Mongo la limpieza es `deleteMany`, **no `drop`**: dropear se llevaría el índice.
  **Limitación conocida:** dos corridas simultáneas del mismo motor se pisarían. Es una
  herramienta de un operador a la vez.
- **Firestore indexa cada campo solo; MongoDB solo `_id`.** Por eso `mongo-runner.ts`
  crea `{ bucket: 1, seq: 1 }` al sembrar: sin ese índice, `queryFiltered` haría un
  COLLSCAN y la comparación mediría un índice faltante, no el motor. Cualquier operación
  nueva que filtre u ordene tiene que igualar condiciones de los dos lados.
- **Cada motor resuelve su propio cliente dentro de su entrada de `ENGINE_RUNNERS`**, y
  recién cuando ya se sabe qué motor se pidió. Antes el endpoint exigía credenciales de
  Firestore incluso para una corrida de MongoDB.
- **Percentiles con interpolación lineal** (NIST / `PERCENTILE.INC`), no el valor observado
  más cercano: con muestras cortas el p95 no queda clavado a una muestra.
- **Locale `es-HN`, no `es`.** `es`/`es-ES` usan coma decimal (`42,18`); `es-HN` mantiene
  el punto. Único punto de cambio: `LOCALE` en `src/benchmark/ui/format.ts`.
- **Firestore vive en `nam5`, que es multirregión.** Cada escritura replica entre regiones
  de EE. UU. antes de confirmarse. No es comparable contra un cluster de región única sin
  declararlo. La UI lo dice en el banner.

## Estructura

| Carpeta | Responsabilidad |
|---|---|
| `src/benchmark/domain/` | Tipos, validación, percentiles, reducer. Cero dependencias hacia afuera. Reexporta todo por `domain/index.ts` — importar desde ahí, no por archivo suelto. |
| `src/benchmark/adapters/` | Implementaciones del puerto: `mock`, `firestore` (servidor), `http` (cliente). |
| `src/benchmark/ui/` | Web Component vanilla, tabla, gráfico SVG, y **todos** los textos en `copy.ts`. |
| `src/server/` | Credenciales y clientes. Solo servidor, nunca importado desde `ui/`. `env.ts` es el único lugar que lee variables de entorno. |
| `src/pages/api/` | Endpoint SSE. Valida entrada y despacha por motor. |
| `src/dataset/domain/` | Las 8 colecciones, el generador determinista, los índices compartidos, los 10 queries y el puerto `DatasetSeeder`. Importable desde Vite **y** desde Node, por eso usa extensiones `.ts` explícitas. |
| `src/dataset/adapters/` | Seeders (`mongo-seeder`, `firestore-seeder`) y las implementaciones de los 10 queries por motor. |
| `src/pages/proyecto.astro` | Página de divulgación para exponer el proyecto: arquitectura, método, decisiones, resultados, glosario y límites. Reusa `GLOSSARY` de `ui/copy.ts`. |
| `src/ui/diagrams/` | Diagramas SVG a mano (`PortDiagram`, `RunFlowDiagram`, `PhaseDiagram`) y `Figure.astro`, la tarjeta que les pone piso de ancho legible. |

Tipografía: **una sola sans, Inter** (sustituto declarado de CursorGothic), para display
y cuerpo por igual — la voz de display sale del tamaño y el tracking negativo en peso 400,
nunca del peso. **JetBrains Mono** para datos y código, con `.tnum` para que las columnas
de latencia no se muevan mientras entran las muestras.

## Convenciones de código

- Sin punto y coma, comillas simples, coma final. `readonly` en todo campo de tipo público
  y `readonly T[]` en los arreglos.
- Funciones exportadas: arrow con **tipo de retorno explícito** y TSDoc con `@param` /
  `@returns` cuando no es trivial. Los comentarios explican **por qué**, no qué.
- Los guards de tipo (`isEngineId`, `isRunEventType`) son la única forma de cruzar el borde
  de la red. Nada de `as` sobre entrada no confiable.
- Campos privados de clase con `#`, no `private`.
- Estado de la UI: `reduceRunState(state, event)`. La vista es una proyección pura del
  estado; no mutar el DOM fuera del render.
- **Los artefactos técnicos (identificadores, comentarios, commits) van en inglés.** La
  copia visible para el usuario va en español y vive únicamente en `ui/copy.ts` y
  `ui/labels.ts`.

## Estilos

**`DESIGN.md` es vinculante.** Define el sistema (Cursor) y, más importante, qué reglas
funcionales el estilo no puede pisar. Leerlo antes de tocar una clase.

Tailwind v4 sin archivo de config: los tokens se declaran en `src/styles/global.css`
dentro de `@theme`.

- **Un solo tema, claro.** No hay modo oscuro, ni atributo `data-theme`, ni variante
  `dark`, ni script anti-flash. Se eliminaron a propósito: Cursor no define valores
  oscuros. `Layout.astro` declara `<meta name="color-scheme" content="light">`.
- **Los componentes nombran un rol, nunca un color.** `bg-surface`, `text-primary`,
  `border-hairline`, `rounded-card`. Los colores de Cursor solo aparecen en el bloque de
  alias de `global.css`.
- **`--color-firestore` y `--color-mongodb` no se reutilizan en la UI.** El color es el
  identificador del motor en gráfico, tabla y leyenda. **Por eso la acción primaria es
  tinta y no el naranja**, aunque el `button primary` de Cursor sí sea naranja: un botón
  del color de Firestore haría mentir al gráfico. Cursor documenta un `button download`
  con fondo tinta, así que el desvío queda dentro del sistema.
- **Los pastel de `timeline-*` no pueden ser series de gráfico.** Están calibrados como
  relleno de pastilla con texto tinta encima: `timeline-read` mide 1.84:1 contra el
  canvas, debajo del 3:1 que exige un objeto gráfico. Firestore mide 3.28:1 y MongoDB
  5.57:1. Medir antes de proponer un color.
- **Mayúsculas solo en `caption-uppercase` (11px).** Bebas Neue era caps-only y hacía
  gratis el `uppercase` en títulos; **Inter no**. Ningún `display-*` lleva `uppercase`,
  y ninguno lleva `leading-none`: los tokens ya traen su interlínea y forzarla a 1 corta
  las descendentes.
- **El mono carga toda columna numérica, con `.tnum`.** Sin cifras tabulares las columnas
  de latencia bailan mientras entran las muestras.
- **Tokens muertos: la trampa que no rompe la compilación.** Dos superficies los
  consumen por nombre y fallan en silencio:
  1. Strings `var(--...)` desde JS (`render-chart.ts`, `colorVar` en `ui/labels.ts`) —
     el SVG se pinta con el valor por defecto.
  2. Clases `fill-*` / `stroke-*` en los diagramas — **peor**: una `fill-*` inexistente
     no deja el elemento sin pintar, lo deja con el negro por defecto de SVG. En la
     migración desde Caldera, `fill-pure-white` puso texto negro sobre caja negra.

  Tras cualquier cambio de tokens: `rg -n "var\(--" src/` y
  `rg -o "(fill|stroke)-[a-z-]+" src/ | sort -u`, y confirmar que cada nombre existe.
- **El ancho de lectura se fija por bloque (`max-w-[70ch]`), no por token.** `max-w-prose`
  es una utilidad fija de Tailwind (65ch) que una variable `--container-prose` **no pisa**.
- Las clases se escriben como **strings estáticos** para que el escáner de Tailwind las
  vea. Las combinaciones repetidas se factorizan en recetas (`src/ui/button-recipes.ts`),
  nunca se construyen por interpolación.
- Solo utilidades de Tailwind en el markup; nada de bloques `<style>` en los `.astro`.
- **Iconos: `src/ui/icons.ts`**, cuerpos SVG en strings (Lucide ISC + Simple Icons CC0).
  Sin librería ni JS en runtime. El mapeo operación/motor → icono vive en las tablas
  totales de `ui/labels.ts`, así que agregar un `OperationId` sin icono no compila.
  La clase se pasa **literal** en el call site o Tailwind no la ve.
- **Si un nodo contiene un icono, nunca asignarle `textContent` al padre**: borra el SVG.
  Por eso el botón de ejecutar expone `[data-ref="run-label"]` y `[data-ref="run-icon"]`,
  y los encabezados de tabla envuelven rótulo y tooltip en un `span`.
- **`src/ui/Checkbox.astro` es el input nativo con `appearance-none`**, no un `div`
  disfrazado: conserva teclado, `<label>`, valor de formulario y estado accesible.
  El tick se revela con `peer-checked`.
- **Los diagramas nunca bajan de su ancho legible.** `Figure.astro` les pone piso de
  52rem y los hace scrollear dentro de la tarjeta. La tarjeta lleva `min-w-0` o el piso
  empuja el track del grid y **scrollea la página** en vez de la tarjeta.

## Dataset y consultas — el estudio de capacidad

El proyecto tiene **dos ejes**: el micro-benchmark de latencia CRUD original y un
estudio de capacidad sobre un dataset sembrado. Los dos entran por el **mismo puerto**
`BenchmarkRunner`: un query es, para la medición, lo mismo que una operación — corré esto
N veces y devolveme las latencias. Por eso `PhaseId = OperationId | QueryId` y el reducer,
la tabla, el gráfico y los percentiles sirven a los dos sin una línea de cambio.

- **El generador es una función pura del índice, no un PRNG con semilla.** Un PRNG guarda
  estado: el documento 500 dependería de haber generado el 499, y reanudar una siembra
  cortada produciría datos distintos a una corrida limpia. Las dos bases dejarían de ser
  idénticas en silencio. Verificado por `scripts/check-dataset.mjs`.
- **Las fechas son milisegundos, no `Date`.** Mongo guarda BSON datetime y Firestore su
  propio `Timestamp` con nanosegundos: al releerlos serían objetos distintos y el criterio
  de identidad fallaría **al leer**, no al escribir.
- **`orderItems` lleva `categoryId` denormalizado** porque Firestore no puede hacer JOIN
  para llegar a él. La verificación comprueba que coincida con la categoría real del
  producto: si no coincidiera, el `$lookup` de Mongo y la agregación por grupo de Firestore
  estarían respondiendo **preguntas distintas**.
- **La siembra es idempotente**: todo es upsert sobre el `_id` determinista, nunca insert.
  Probado sembrando dos veces y **contando en la base**, no leyendo el log.
- **Los índices se crean después de los datos y se cronometran aparte.** Crearlos antes
  haría que cada escritura los mantenga, inflando la siembra y desinflando la indexación.
- **`INDEXES` se declara una sola vez para los dos motores.** Si cada adaptador eligiera
  los suyos, mediríamos una decisión de indexación en vez de un motor.

### Los límites que definen el trabajo

| | MongoDB Atlas M0 | Firestore Spark |
|---|---|---|
| Almacenamiento | 512 MB | 1 GiB |
| Escrituras | sin cupo | **20.000/día** |
| Lecturas | sin cupo | 50.000/día |
| Borrados | sin cupo | 20.000/día |

**1M de documentos son 50 días en Spark.** Por eso hay dos escalas: `PAIRED_SCALE` (18.000,
pareada, dimensionada por el cupo diario con 2.000 de margen) y `SCALE_DEMO` (1.000.000,
**solo MongoDB**, 101 MB medidos de los 512).

Los borrados también consumen cupo, así que rehacer una siembra en Firestore cuesta un día
de borrados más otro de escrituras: **hay un intento por día**. El seeder guarda el progreso
en `.seed-state.<motor>.<escala>.json` y `Ctrl+C` no lo pierde.

**`ANALISIS.md` es el entregable del estudio.** Cubre los nueve criterios con los
números medidos y, sobre todo, con lo que cada motor NO permite medir. Si cambia una
medición, se actualiza ahí — no en un comentario suelto.

`GET /api/context` reporta en vivo las condiciones de cada motor: red (mediana de 7
muestras), tamaño y parámetros. Nunca se cachea: un contexto cacheado describiría una
base de otro momento al lado de números de este.

### Las asimetrías, que son el hallazgo

- **Firestore no tiene subqueries, JOIN, GROUP BY ni HAVING.** 5 de los 10 queries corren
  nativos; los otros 5 existen porque les escribimos el motor que falta a mano. Cada uno
  declara su `FirestoreStrategy` tipada, y la UI la muestra al lado de la consulta.
- **Las agregaciones se cobran 1 lectura por cada 1.000 entradas de índice**, no por
  documento. Emular `GROUP BY` trayendo todo costaría 1.800.000 lecturas/día (36× sobre el
  cupo); una agregación por grupo cuesta 3.000. **600× de diferencia** — pero exige
  cardinalidad conocida y acotada, así que **no generaliza**.
- **Firestore no puede crear índices compuestos desde el SDK.** Se declaran en
  `firestore.indexes.json` (generado por `scripts/firestore-indexes.mjs` desde la misma
  tabla) y se construyen en background: no hay momento del cliente que cronometrar.
- **Firestore no expone el tamaño de la base por API.** Mongo lo da con `dbStats`.
- **Firestore no tiene parámetros de cluster.** Es serverless: no hay tier, ni CPU, ni RAM.
  Solo ubicación y modo. No se pueden "igualar parámetros"; solo declarar los dos lados.

## Comandos

```bash
npm install
cp .env.example .env      # y completar
npm run dev               # astro dev
npm run build             # astro build — debe pasar antes de commitear
npm run preview
npx astro check           # 0 errores esperados; no hay script npm para esto
```

Dataset (Node, con stripping de tipos):

```bash
node --experimental-strip-types scripts/check-dataset.mjs          # verifica el generador ANTES de escribir
node --experimental-strip-types --env-file=.env scripts/seed.mjs --dry-run
node --experimental-strip-types --env-file=.env scripts/seed.mjs --scale=paired
node --experimental-strip-types --env-file=.env scripts/seed.mjs --engine=firestore   # techo 19.000
node --experimental-strip-types --env-file=.env scripts/seed.mjs --scale=demo         # 1M, solo Mongo
node --experimental-strip-types scripts/firestore-indexes.mjs --write
```

Verificación de credenciales y conectividad:

```bash
node scripts/check-env.mjs                 # forma del .env + parseo criptográfico de la llave
node scripts/check-firestore.mjs           # conecta de verdad, solo lectura
node scripts/check-firestore-location.mjs  # región y tipo de la base
node scripts/import-service-account.mjs ruta/al/key.json --write
```

**No hay runner de tests ni linter en el repo.** La red de seguridad es el compilador:
`npx astro check` + `npm run build`. Existió un script de verificación del dominio
(32 aserciones: percentiles, validación, determinismo, cancelación) que vivía en el
scratchpad; si hace falta de nuevo, se reescribe o se instala vitest.

Servidor de desarrollo en segundo plano: `astro dev --background`, y se maneja con
`astro dev stop|status|logs`.

## Despliegue

`@astrojs/vercel` como adaptador; el endpoint declara `export const prerender = false`.

- **`regions: ["iad1"]`** en `vercel.json` — la función serverless es la que mide. Si
  Vercel la ubica lejos de la base, cada muestra incluye esa distancia y el benchmark deja
  de medir la base para medir la topología.
- **`maxDuration` va en el adaptador (`astro.config.mjs`), NO en `functions` de
  `vercel.json`.** El adaptador emite **una sola** función para todas las rutas
  (`_render.func`), así que un patrón por archivo como `src/pages/api/benchmark.ts` no
  matchea nada y **rompe el build**: `doesn't match any Serverless Functions`.
  Verificable en `.vercel/output/functions/_render.func/.vc-config.json` tras el build.
- **`maxDuration: 300`, no 60.** Una corrida completa son 200 iteraciones × 5 operaciones
  × 2 motores; a los ~110 ms medidos de Firestore y ~52 ms de MongoDB son unos **162 s**.
  Con 60 se truncaba a un tercio y el reporte salía incompleto sin avisar.
- Ese mismo archivo confirma `supportsResponseStreaming: true`, que es lo que el endpoint
  SSE necesita para transmitir muestra a muestra en vez de responder al final.

## Estado actual

- Ambos motores **funcionando y medidos**. 30 iteraciones, 1024 B, concurrencia 1, desde
  Honduras, 0 errores en las 10 fases. p95 en ms:

  | | insertOne | findById | queryFiltered | updateOne | deleteOne |
  |---|---|---|---|---|---|
  | Firestore (`nam5`) | 127.8 | 99.7 | 154.9 | 120.2 | 113.5 |
  | MongoDB (Atlas M0) | 54.3 | 52.1 | 52.7 | 55.8 | 56.1 |

- **Esos números NO dicen "MongoDB es 2-3× más rápido".** El piso de red hacia el cluster
  es ~50 ms, así que la operación de Mongo cuesta **2-6 ms** y el resto es viaje. La
  prueba está en la propia tabla: si el motor dominara, la brecha en escrituras (Firestore
  hace consenso multirregión antes de confirmar) sería mucho mayor que en lecturas, y va
  de 1.9× en `findById` a 2.4× en `insertOne`. Un factor común a todas las operaciones —
  la latencia de red — es lo que manda. Desplegado, la función mide desde `iad1` y estos
  números cambian.
- **`queryFiltered` en Firestore exige un índice compuesto creado a mano, una sola vez**
  (`_bench_queryFiltered`: `bucket` ASC, `seq` ASC). Ya está creado en
  el proyecto Firebase en uso. En un proyecto nuevo hay que rehacerlo o esa fase
  devuelve `errorCount = iterations`; el link exacto aparece en los logs cuando falla.
- **Multi-motor: implementado.** `createSequentialRunner` (`adapters/sequential-runner.ts`)
  combina varios runners **cumpliendo el mismo puerto**, así que la UI no distingue una
  corrida de un motor de una de varios. El endpoint siempre pasa por él, incluso con un
  solo motor: un único camino de código.
- Un M0 comparte CPU: su cola de latencia es más ruidosa. Con 10 iteraciones se vio un
  `updateOne` con p95 de 835 ms sobre un p50 de 54 ms. Sacar conclusiones de la cola exige
  muestras largas.
- **Los motores corren en secuencia, nunca en paralelo.** Simultáneos competirían por la
  CPU y el ancho de banda de la misma función serverless, y cada uno inflaría la latencia
  del otro: la corrida mediría contención, no motores. `sequential-runner.ts` también
  traga los `run-completed` intermedios — uno por motor daría la corrida por terminada en
  la UI con motores todavía pendientes — y fusiona los resultados en un único report.
- Operaciones declaradas en el dominio pero **no expuestas** en `DEFAULT_CONFIG`:
  `insertMany` y `aggregate`. El adaptador de Firestore ya las implementa.
- Ramas: `feature/*` → `development` → PR → `main`. `main` no acepta push directo.

## Credenciales

Nunca en el repo. `.env` está ignorado; `.env.example` documenta cada variable.
`FIRESTORE_PRIVATE_KEY` se guarda con los `\n` **literales** y el servidor los expande al
arrancar (`rawKey.split('\\n').join('\n')` en `src/server/firestore-client.ts`).

`readEnv` consulta **`import.meta.env` y luego `process.env`**: lo primero cubre el dev
server de Astro, lo segundo el runtime de Vercel. Agregar una variable de servidor exige
pasar por ahí. Ninguna variable lleva prefijo `PUBLIC_`, así que ninguna llega al navegador.

`BENCH_MAX_ITERATIONS` (default 500) es un techo aplicado en el servidor, independiente de
lo que pida la UI: `Math.min(config.iterations, maxIterations)` en el adaptador.
