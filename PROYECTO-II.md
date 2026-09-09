# Proyecto II — Benchmark de Bases de Datos

**Cloud Firestore vs. MongoDB Atlas**
Documento de entrega. Mapea uno a uno las tres fases del enunciado.

| | |
|---|---|
| Motores comparados | Cloud Firestore · MongoDB Atlas |
| Herramienta | BenchmarkRunner — aplicación propia, Astro 7 + TypeScript |
| Dataset | 8 colecciones, 18.000 registros pareados, generador determinista |
| Punto de medición | servidor de la aplicación, en Honduras |
| Fecha de las mediciones | septiembre 2026 |

> **La regla que gobierna todo el informe:** ningún número se presenta sin su
> piso de red. Desde Honduras ese piso es **~46 ms hacia MongoDB** y
> **~105–158 ms hacia Firestore**. Una diferencia menor al piso **no es
> atribuible al motor**.

---

# Fase 1 · Planificación

## 1.a Velocidad de inserción de registros

**Qué se mide.** Dos cosas distintas que el enunciado junta en una:

| Medición | Pregunta que responde | Unidad |
|---|---|---|
| Latencia de `insertOne` | ¿cuánto tarda **una** escritura? | ms (p50 / p95) |
| Rendimiento de siembra | ¿cuántos registros por segundo entran en **volumen**? | docs/s |

**No se derivan una de la otra.** Son preguntas diferentes y se mueven en
direcciones opuestas al subir la concurrencia. Está demostrado con números en la
sección de pruebas sensitivas.

**Cómo se mide.**

- `insertOne`: N iteraciones cronometradas una por una, con calentamiento
  descartado, sobre una colección dedicada `_bench_insertOne` que se vacía al
  entrar **y** al salir de la fase.
- Siembra: 18.000 documentos en lotes de 500 con 8 lotes en vuelo, cronometrando
  el total y cada colección por separado.

**Controles aplicados.**

- Tamaño de documento idéntico en los dos motores, con relleno calculado para que
  el documento pese lo mismo en ambos.
- La siembra es **idempotente**: todo es *upsert* sobre un `_id` determinista.
  Sembrar dos veces no duplica, y se verifica **contando en la base**, no leyendo
  el log del proceso que acaba de escribir.
- Los índices se crean **después** de los datos y se cronometran aparte. Crearlos
  antes obligaría a cada escritura a mantenerlos: **inflaría el número de siembra
  y desinflaría el de indexación**. El enunciado pide los dos, así que no pueden
  contaminarse.
- `deleteOne` siembra `iterations + warmup` documentos. Con solo `iterations`, el
  calentamiento consume los primeros y la medición vuelve a borrarlos: Firestore
  no falla al borrar algo inexistente, así que `errorCount` quedaría en 0 y los
  números saldrían limpios **y falsos**.

## 1.b Velocidad de lectura de registros insertados

**Qué se mide.** Tres niveles, de menor a mayor exigencia:

| Nivel | Operación | Qué ejercita |
|---|---|---|
| 1 | `findById` | lectura por clave primaria |
| 2 | `queryFiltered` | filtro + orden sobre índice compuesto |
| 3 | 10 consultas del dataset | filtros, rangos, agrupaciones, uniones |

Las 10 consultas se dividen en **5 simples** (nativas en ambos motores) y
**5 complejas** (`GROUP BY`, `HAVING`, `JOIN`, subconsultas). Esa división no es
decorativa: es el hallazgo central del proyecto, porque **ninguna de las 5
complejas existe en Firestore**.

**Controles aplicados.**

- Los índices se declaran **una sola vez para los dos motores**
  (`src/dataset/domain/indexes.ts`). Si cada adaptador eligiera los suyos,
  estaríamos midiendo una decisión de indexación, no un motor.
- Cada consulta se declara **como dato**, con su enunciado en español, para que
  los dos motores respondan **la misma pregunta**.
- El percentil usa interpolación lineal (NIST / `PERCENTILE.INC`), no el valor
  observado más cercano: con muestras cortas el p95 no queda clavado a una
  muestra.

## 1.c Verificación del tamaño de las bases de datos

**Qué se mide.** Cuatro cifras, antes y después de sembrar: documentos, bytes de
datos, bytes en disco y bytes de índice.

**Cómo se mide.** `dbStats` / `collStats` en MongoDB. En Firestore, **no se
puede**: ningún método del SDK devuelve el tamaño de la base. Esa imposibilidad
**es en sí misma un resultado del benchmark** y se reporta como tal — no se
rellena con una estimación.

---

# Fase 2 · Captura y análisis de la información

## 2.a Herramienta seleccionada

**BenchmarkRunner**, aplicación construida para este proyecto.

**Por qué no una herramienta genérica.** YCSB, `mongo-perf` o un script suelto
miden operaciones CRUD contra un motor. Ninguna responde la pregunta que el
enunciado exige: *¿qué **no** puede hacer cada motor?* Esa respuesta requiere
implementar las mismas 10 preguntas de negocio en los dos, y ahí aparecen las
asimetrías.

| Componente | Tecnología | Por qué |
|---|---|---|
| Aplicación | Astro 7 + TypeScript estricto | sin framework de UI; el bundle cliente no carga ningún SDK de base |
| Medición | servidor (endpoint SSE) | el navegador nunca toca credenciales ni bases |
| Transporte | Server-Sent Events | cada muestra se transmite al terminar, no al final de la corrida |
| Reloj | `performance.now()` | monotónico; inmune a ajustes del reloj del sistema |
| Despliegue | Vercel, región `iad1` fija | si la función se moviera, cada muestra incluiría esa distancia |

**La decisión de arquitectura que sostiene el informe.** El dominio define **un
solo puerto**:

```ts
export type BenchmarkRunner = {
  readonly plannedSamples: (config: BenchmarkConfig) => number
  readonly run: (config: BenchmarkConfig, signal: AbortSignal) => AsyncIterable<RunEvent>
}
```

Firestore, MongoDB, las consultas del dataset y el combinador multi-motor lo
implementan **todos**. Para la medición, una consulta es exactamente lo mismo que
una operación: *corré esto N veces y devolveme las latencias*. Por eso el mismo
reducer, la misma tabla, el mismo gráfico y los mismos percentiles sirven a los
dos ejes del estudio sin una línea de diferencia.

## 2.b Análisis de los parámetros

### Condiciones declaradas de los dos lados

| | MongoDB Atlas | Firestore |
|---|---|---|
| Plan | M0 · compartido, gratuito | Spark · gratuito |
| Versión | 8.0.32 | no versionada al usuario |
| Motor de almacenamiento | WiredTiger | no expuesto |
| Tier / CPU / RAM | compartido, no detallado | **no existe** — serverless |
| Conexiones | 500 máximo | no aplica |
| Topología | replica set de 3 nodos | no expuesta |
| Ubicación | región única | `nam5`, **multirregión** |
| Almacenamiento | 512 MB | 1 GiB |
| Cupo de escrituras | sin cupo diario | **20.000/día** |
| Cupo de lecturas | sin cupo diario | 50.000/día |
| Cupo de borrados | sin cupo diario | 20.000/día |

**No se pueden "igualar los parámetros de cluster", porque Firestore no tiene
ninguno.** Lo único honesto es declarar los dos lados completos y decir en voz
alta que se compara un tier compartido contra un servicio sin tier.

### Piso de red — el parámetro que domina todo

Mediana de 7 muestras, desde el servidor de la aplicación en Honduras.

| Motor | Mediana | Mín | Máx | Destino |
|---|---:|---:|---:|---|
| MongoDB Atlas | **46–49 ms** | 45 | 51 | `equipo4.iawiuqr.mongodb.net` |
| Firestore | **105–158 ms** | 97 | 214 | `nam5`, multirregión |

Firestore tiene **2–3× el piso de red de MongoDB** desde acá, y una dispersión
mucho mayor. Ese piso está debajo de **cada** número del informe.

La aplicación lo reporta en vivo en el panel *Condiciones de la medición*
(`GET /api/context`), y **nunca se cachea**: un contexto cacheado describiría una
base de otro momento al lado de números de este.

### Por qué el ganador se decide por p95 y no por la media

La media esconde la cola. Un motor con media de 50 ms y p95 de 800 ms se siente
peor que uno con media de 60 ms y p95 de 70 ms, porque **la cola es lo que el
usuario percibe**. Un empate exacto o un motor único no producen ganador.

## 2.c Datos obtenidos

### CRUD — latencia p95, en milisegundos

30 iteraciones, 1.024 B, concurrencia 1, desde Honduras. **0 errores en las 10 fases.**

| | insertOne | findById | queryFiltered | updateOne | deleteOne |
|---|---:|---:|---:|---:|---:|
| Firestore (`nam5`) | 127,8 | 99,7 | 154,9 | 120,2 | 113,5 |
| MongoDB (Atlas M0) | 54,3 | 52,1 | 52,7 | 55,8 | 56,1 |
| **Cociente** | 2,4× | 1,9× | 2,9× | 2,2× | 2,0× |

**Estos números NO dicen "MongoDB es 2-3× más rápido".** La prueba está en la
propia tabla: si el motor dominara, la brecha en **escrituras** — donde Firestore
hace consenso multirregión antes de confirmar — sería mucho mayor que en
**lecturas**. Va de 1,9× a 2,9× sin patrón por tipo de operación. **Un factor
común a todas las operaciones — la latencia de red — es lo que manda.**

Descontando el piso de red, el trabajo real del motor MongoDB es de **2 a 6 ms**.

### Velocidad de inserción en volumen — MongoDB

18.000 documentos contra el M0 real:

| | |
|---|---:|
| Total | **28,7 s** |
| `orderItems` (11.000 docs) | **1.226 docs/s** |
| `orders` (3.500 docs) | 497 docs/s |
| `reviews` (1.700 docs) | 426 docs/s |
| Lotes secuenciales, sin concurrencia | 366 docs/s |

**3,3× de ganancia solo por concurrencia**, con 8 lotes en vuelo. Confirma lo
mismo que la sección de red: el costo es el viaje, no el servidor. Un lote de
1.000 documentos tarda casi lo mismo que uno de 100, así que lo que se paga es el
**número de idas y vueltas**.

Proyección para 1.000.000 de documentos en MongoDB: ~46 minutos secuencial,
menos de 10 con concurrencia.

### Creación de índices — MongoDB

```
15 índices sobre 8 colecciones · 1.719 ms total · 107–135 ms cada uno
```

En Firestore **no aplica**, por tres razones distintas:

1. **Las colecciones no se crean.** Nacen con el primer documento. No hay
   `CREATE`, así que "cuánto tarda crear la tabla" es cero por definición.
2. **Los índices de campo simple son automáticos.** Nunca se declaran.
3. **Los compuestos no se crean desde el SDK.** Se declaran y **se construyen en
   background**. No hay momento del cliente que cronometrar.

> **Cuidado con leer el punto 2 de más.** "Firestore indexa todo automáticamente"
> es verdad **solo para campos simples**. El índice **compuesto** —el que hace
> falta apenas la consulta combina campos u ordena por uno que no filtra— **no se
> crea nunca solo**. Medido sobre un proyecto nuevo con la base vacía: **7 de las
> 10 consultas fallan** con `FAILED_PRECONDITION` hasta declararlos.

### Dos hallazgos que solo aparecen al medirlo

**El requisito se decide al planificar, no al leer.** Una consulta contra una
colección **vacía** reclama el índice igual. Eso permite descubrir la lista
completa **sin sembrar un solo documento y sin gastar cupo de escritura** — lo
que, con 20.000 escrituras por día, no es un detalle menor.

**Firestore necesita más índices que MongoDB para las mismas diez preguntas.**

| | MongoDB | Firestore |
|---|---:|---:|
| Compuestos para las 10 consultas | 9 | **11** |
| Índices totales declarados | 15 | 11 + los automáticos de campo simple |

MongoDB sirve un orden descendente recorriendo un índice ascendente al revés, así
que **uno cubre las dos direcciones**. Firestore no puede: necesita un compuesto
por dirección, y además un `sum()`/`average()` filtrado le exige el campo agregado
**ascendente** aunque la consulta nunca ordene por él. **Dos índices existen solo
por eso**: `orders (customerId, total)` y `reviews (productId, rating ASC)`.

Construir esas copias también en MongoDB habría sido "tratar igual a los dos
motores", pero habría inflado su tamaño de índice con estructuras que su
planificador no puede usar — y el KPI de eficiencia de almacenamiento habría
mentido a favor de Firestore.

**Y hay una asimetría más, operativa:** crear índices por API exige
`roles/datastore.indexAdmin`, que el service account de Firebase **no trae por
defecto**. Verificado en dos proyectos: listar responde 200, crear responde
**403**. Es un permiso de IAM, no un problema de código.

### Tamaño de las bases

**MongoDB — medido por API:**

| | Antes | Después de 18.000 |
|---|---:|---:|
| Documentos | 0 | 18.000 |
| Datos | 0 MB | **3,17 MB** |
| En disco | 1,76 MB | **4,14 MB** |
| Índices | 1,15 MB | **2,73 MB** |
| **Total** | 2,91 MB | **6,87 MB** de 512 |

**Los índices pesan el 66% de los datos.** Con 15 índices compuestos sobre 18.000
documentos, casi dos tercios del espacio no son información: son la estructura
que permite encontrarla.

**Firestore — no se puede medir por API.** Ningún método del SDK devuelve el
tamaño. Sale de la consola de Firebase o de Cloud Monitoring. Y hay razón para
esperar que sea peor: **Firestore indexa cada campo automáticamente**, así que
para un documento de 12 campos el índice suele pesar más que el dato. El GiB
gratuito se agota mucho antes de lo que sugiere el tamaño de los documentos.

> **Esta asimetría es un resultado: uno de los dos motores permite auditar su
> propio consumo y el otro no.**

### Lectura — las 10 consultas, MongoDB, 18.000 documentos

5 iteraciones por consulta, 1 de calentamiento, concurrencia 1. **0 errores.**

| Consulta | Tipo | p50 | p95 |
|---|---|---:|---:|
| Productos por categoría | simple | 44,74 | 45,23 |
| Pedidos de un cliente | simple | 44,62 | 50,29 |
| Pedidos por estado y fecha | simple | 44,95 | 53,86 |
| Clientes por segmento | simple | 44,47 | 44,87 |
| Reseñas de un producto | simple | 44,31 | 45,02 |
| Facturación por categoría | **compleja** | **51,22** | 51,74 |
| Ticket promedio por categoría | **compleja** | **54,00** | 59,35 |
| Pedidos unidos a cobros | **compleja** | **46,20** | 46,59 |
| Clientes sobre el promedio | **compleja** | **53,65** | 59,12 |
| Productos mejor calificados | **compleja** | **49,36** | 60,63 |

Las simples se agrupan en 44–45 ms; las complejas suben a 46–54 ms. **Sobre un
piso de red de 46 ms, el trabajo real del motor es de 0 a 8 ms.** El pipeline de
agregación de MongoDB, sobre 18.000 documentos, casi no cuesta.

### Estado de la medición en Firestore

| Eje | Estado |
|---|---|
| CRUD (5 operaciones) | **medido** — tabla p95 arriba |
| Dataset sembrado | **no** — 0 documentos, verificado por API |
| 10 consultas de lectura | **no medidas** — dependen del dataset |
| Índices compuestos del dataset (9) | **no creados** |
| Tamaño de la base | **no medible por API** |

**Por qué.** Sembrar 18.000 documentos consume 18.000 de las 20.000 escrituras
diarias del plan Spark: **hay un intento por día**. Los borrados también consumen
cupo, así que rehacer una siembra cuesta un día de borrados más otro de
escrituras. El intento de siembra devolvió `RESOURCE_EXHAUSTED: Quota exceeded`
con **0 documentos escritos** — el cupo del día ya estaba consumido por las
corridas CRUD.

Los adaptadores están escritos y verificados; la tabla comparativa de consultas
se completa en la corrida siguiente a una siembra exitosa.

---

# Fase 3 · Plan de acción

## 3.a Líder del benchmark

### En condiciones medidas: **MongoDB Atlas**

Gana **las 5 operaciones CRUD** por p95, con cocientes de 1,9× a 2,9×, y es el
único de los dos que pudo completar las 10 consultas de lectura.

### La salvedad que hace honesto el resultado

**La mayor parte de esa ventaja es geografía, no motor.** El piso de red hacia
MongoDB desde Honduras es ~46 ms y hacia Firestore ~105–158 ms. Desplegada la
función en `iad1` (Virginia), ambos pisos bajan y **estos cocientes cambian**.

Lo que **no** cambia con la geografía, y es la ventaja estructural real:

| | MongoDB | Firestore |
|---|---|---|
| `GROUP BY` / `HAVING` | nativo | **no existe** |
| `JOIN` (`$lookup`) | nativo | **no existe** |
| Subconsultas | nativo | **no existe** |
| Auditar el tamaño propio | `dbStats` | **imposible por API** |
| Cupo de escritura diario | ninguno | 20.000 |

**5 de las 10 consultas del enunciado solo corren en Firestore porque les
escribimos a mano el motor que falta.** Esa es la diferencia que sobrevive a
cualquier cambio de región.

### Dónde Firestore es el líder

No en este benchmark, pero honestamente: escala automática sin operación, modelo
de seguridad declarativo, sincronización en tiempo real con el cliente y cero
administración de servidores. **Este proyecto midió latencia y capacidad
analítica. No midió costo operativo, y ahí el orden se invierte.**

## 3.b KPI definidos

| # | KPI | Definición | Umbral | MongoDB | Firestore |
|---|---|---|---|---|---|
| 1 | **Latencia de escritura** | p95 de `insertOne` | < 100 ms | 54,3 ms ✅ | 127,8 ms ❌ |
| 2 | **Latencia de lectura por clave** | p95 de `findById` | < 100 ms | 52,1 ms ✅ | 99,7 ms ⚠️ |
| 3 | **Latencia de consulta indexada** | p95 de `queryFiltered` | < 100 ms | 52,7 ms ✅ | 154,9 ms ❌ |
| 4 | **Sobrecosto del motor** | p95 − piso de red | < 15 ms | 2–6 ms ✅ | sin dato |
| 5 | **Rendimiento de carga** | docs/s en siembra concurrente | > 1.000 | 1.226 ✅ | no medible hoy |
| 6 | **Eficiencia de almacenamiento** | bytes de índice / bytes de dato | < 1,0 | 0,86 ✅ | **no auditable** ❌ |
| 7 | **Cobertura funcional** | consultas nativas / 10 | 10/10 | 10/10 ✅ | **5/10** ❌ |
| 8 | **Tasa de error** | errores / muestras | 0 % | 0 % ✅ | 0 % en CRUD ✅ |
| 9 | **Estabilidad de la cola** | p95 / p50 | < 1,5 | 1,03 ✅ | no registrado |
| 10 | **Autonomía de operación** | ¿puede medir su propio consumo? | sí | sí ✅ | **no** ❌ |

**KPI 4 y KPI 10 son los que aportan algo que una tabla de latencias no dice.**
El 4 separa el motor de la geografía; el 10 mide si el motor permite auditarse,
que es una propiedad operativa, no de rendimiento.

**KPI 9 depende de la carga**, y ese es justamente el hallazgo de las pruebas
sensitivas: a concurrencia 1 vale 1,03, y a concurrencia 16 salta a **4,39**.

## 3.c Conclusiones y recomendaciones

### Conclusiones

**1. Ninguna diferencia menor a 46 ms es atribuible al motor.** Cualquier informe
que compare estas bases sin declarar su latencia de red está midiendo geografía y
llamándolo rendimiento.

**2. Los índices no son gratis.** El 66 % del espacio ocupado en MongoDB son
índices. Firestore, que indexa todo automáticamente, paga más y **no permite
medirlo**.

**3. Firestore no es una base con menos funciones: es un modelo distinto.** Sin
agrupación, sin uniones y sin subconsultas, la lógica que un motor relacional
resuelve en una sentencia se muda a la aplicación. Se puede elegir a conciencia —
pero hay que saberlo antes, no descubrirlo con el proyecto a medio hacer.

**4. Las capas gratuitas no son una versión chica del producto.** 20.000
escrituras por día no es "un poco menos": es la diferencia entre poder sembrar un
millón de registros y no poder. En este proyecto **bloqueó una medición completa**.

**5. Comparar sin igualar condiciones es peor que no comparar.** Igualamos los
índices declarándolos una vez para los dos motores, los datos con un generador
determinista y las preguntas declarando las consultas como datos. Lo que **no** se
pudo igualar está enumerado, no escondido.

**6. Latencia y rendimiento son preguntas distintas.** Medido: al pasar de
concurrencia 1 a 8, el rendimiento sube **7,3×** mientras la latencia p50 se mueve
**1,2 %**. Derivar una de la otra produce números que se mueven al revés de la
realidad.

### Recomendaciones

| Escenario | Motor recomendado | Por qué |
|---|---|---|
| Reportería, analítica, agregaciones | **MongoDB** | `$group`, `$lookup` y subconsultas nativos |
| Auditoría de consumo y capacidad | **MongoDB** | único que expone su propio tamaño |
| App móvil con sincronización en vivo | **Firestore** | listeners en tiempo real, sin servidor que operar |
| Escala impredecible, equipo sin DBA | **Firestore** | serverless real, cero administración |
| Cargas masivas de escritura | **MongoDB** | Firestore cobra por documento y limita por día |

**Recomendaciones de método**, para quien repita este benchmark:

1. **Declarar el piso de red antes que cualquier número.** Sin eso, el informe
   miente sin proponérselo.
2. **Medir desde la misma región que la base**, o declarar la distancia. Fijamos
   `regions: ["iad1"]` en Vercel por esta razón.
3. **Reportar p50 y p95 juntos.** Medido: a concurrencia 8 el p50 de `findById` no
   se movió y el p95 se multiplicó por 5. Un solo número habría escondido eso.
4. **Cronometrar la indexación aparte de la carga**, o los dos números salen
   contaminados.
5. **Verificar la idempotencia contando en la base**, no leyendo el log del
   proceso que acaba de escribir.
6. **No subir la concurrencia sin buscar el codo.** Está medido abajo: en un M0
   está entre 8 y 16, y pasarlo cuesta rendimiento **y** latencia.

---

# Pruebas sensitivas

Una tabla de latencias responde *cuán rápido es*. No responde *cuánto puedo
confiar en este número*. Eso es lo que mide una prueba sensitiva: **se mueve un
solo parámetro, se dejan fijos los demás, y se observa si la lectura es estable o
si el parámetro la domina**.

Ejecutadas contra **MongoDB Atlas M0** con `scripts/sensitivity.mjs`, que maneja
el mismo endpoint que la interfaz — los números salen del camino de producción,
no de una copia privada de la lógica de medición. Firestore quedó fuera por cupo
diario agotado; el script acepta `--engine=firestore` sin cambios.

Configuración base: **30 iteraciones, 5 de calentamiento, 1.024 B, concurrencia
1**, operaciones `insertOne` y `findById`. Datos crudos completos en
`sensibilidad.json`.

## S1 · Sensibilidad a la concurrencia

`insertOne`, la serie limpia:

| Concurrencia | p50 | p95 | Máx | Desv. | **Rendimiento real** | `opsPerSecond` |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 53,50 | 55,18 | 59,41 | 1,33 | **18,57 op/s** | 18,59 |
| 2 | 53,61 | 55,13 | 55,23 | 0,89 | **37,14 op/s** | 18,68 |
| 4 | 53,87 | 55,23 | 55,46 | 0,93 | **69,05 op/s** | 18,60 |
| 8 | 54,16 | 55,81 | 56,14 | 0,87 | **135,57 op/s** | 18,44 |
| 16 | 55,86 | **245,37** | 378,92 | 78,47 | **68,62 op/s** | 12,74 |

**Tres hallazgos, todos medidos:**

**1. Hay un codo de saturación entre 8 y 16.** Hasta 8, el rendimiento escala casi
lineal —de 18,57 a 135,57 op/s, **7,3× por 8× de concurrencia**— mientras el p50
se mueve **1,2 %** y el p95 apenas 1 %. A 16 el sistema se cae: el p95 se
multiplica por **4,4** y el rendimiento **se parte a la mitad**. Un M0 comparte
CPU; pasado el codo, la contención cuesta más de lo que el paralelismo gana.

**2. `opsPerSecond` no es rendimiento, y acá está la prueba.** La columna de la
derecha —la inversa de la media, que es lo que reporta `summary.opsPerSecond`— se
queda clavada en ~18,6 **mientras el rendimiento real sube 7,3×**. Y a
concurrencia 16 **baja** justo cuando debería mostrar el colapso por otra razón.
Derivar rendimiento de la latencia media produce un número que se mueve al revés.
El rendimiento correcto sale del reloj de pared de la fase.

**3. La cola se rompe antes que la mediana.** `findById` a concurrencia 2 y 8
mostró p95 de **277 ms** y **260 ms** con desviación de ~100 ms, mientras su p50
no se movió de 50–51 ms. En un tier compartido la cola es episódica: **el p50
sigue siendo bueno cuando el p95 ya es malo.** Reportar uno solo esconde el
problema.

## S2 · Sensibilidad al tamaño del documento

| Tamaño | p50 `insertOne` | p95 `insertOne` | p50 `findById` | p95 `findById` |
|---:|---:|---:|---:|---:|
| 256 B | 53,05 | 54,63 | 50,45 | 53,91 |
| 1.024 B | 53,04 | 55,20 | 50,56 | 51,92 |
| 4.096 B | 52,85 | 56,18 | 50,40 | 52,00 |
| 16.384 B | 54,63 | **65,43** | 51,31 | 59,21 |

**El tamaño del documento casi no importa hasta los 16 KB.** De 256 B a 4.096 B
—**16× el payload**— el p50 se mueve **0,4 %**, dentro del ruido. Recién a 16 KB
aparece: +3 % en p50 y **+18 % en p95**.

**Interpretación:** con un piso de red de 46 ms, **el costo es el viaje, no los
bytes**. Esto valida por un segundo camino la conclusión de la sección de siembra
—donde 8 lotes en vuelo dieron 3,3×— y explica por qué lo que se paga es el
número de idas y vueltas.

**Consecuencia para el informe:** el parámetro *tamaño de documento* **no es una
variable de confusión** en el rango que usamos. Los 1.024 B por defecto no
inclinan la comparación.

## S3 · Sensibilidad al número de iteraciones

`insertOne`:

| Iteraciones | p50 | p95 | Máx | Desviación |
|---:|---:|---:|---:|---:|
| 10 | 52,84 | 53,93 | 53,97 | 0,81 |
| 30 | 52,93 | 54,91 | 57,98 | 1,24 |
| 100 | 53,15 | 55,99 | 66,11 | 2,40 |
| 200 | 53,12 | 55,37 | 67,79 | 2,03 |

**El p50 es estable desde 10 muestras** — se mueve 0,6 % entre 10 y 200. **El p95
sube y se asienta hacia las 100.** El **máximo no converge nunca**: crece de 53,97
a 67,79 porque, por definición, más muestras capturan más valores atípicos.

**Regla operativa que sale de acá:**

| Métrica | Muestras mínimas | Por qué |
|---|---:|---|
| p50 | 10 | ya estable |
| p95 | **100** | sigue moviéndose por debajo |
| máx | — | **no reportar como métrica**: crece con n |

Todas las mediciones CRUD de este informe usan 30 iteraciones. **Sus p50 son
confiables; sus p95 deben leerse como indicativos**, y una publicación final
debería repetirlas a 100. La desviación estándar reportada permite juzgarlo:
1,24 ms sobre 52,93 es un 2,3 % de dispersión.

## Resumen de sensibilidad

| Parámetro | ¿Domina la lectura? | Umbral seguro | Consecuencia |
|---|---|---|---|
| **Concurrencia** | **Sí, fuerte** | ≤ 8 en un M0 | pasado el codo, p95 ×4,4 y rendimiento ÷2 |
| **Tamaño del documento** | No, hasta 4 KB | ≤ 4.096 B | no es variable de confusión |
| **Iteraciones** | Solo en la cola | ≥ 100 para p95 | el p50 ya es estable en 10 |
| **Piso de red** | **Sí, dominante** | — | está debajo de todos los números |

---

# Registros necesarios para ejecutar el benchmark

## El dataset — 8 colecciones, 18.000 registros pareados

| Colección | Registros | Papel en las consultas |
|---|---:|---|
| `categories` | 10 | agrupación por categoría |
| `suppliers` | 40 | unión con productos |
| `products` | 150 | filtro por categoría, orden por precio |
| `customers` | 900 | segmentación, altas por fecha |
| `orders` | 3.500 | historial, estado, rango de fechas |
| `orderItems` | 11.000 | facturación, ticket promedio, `HAVING` |
| `payments` | 700 | unión pedidos–cobros |
| `reviews` | 1.700 | calificación media por producto |
| **Total** | **18.000** | |

**La escala está dimensionada por el cupo**, no elegida al azar: 18.000 deja 2.000
escrituras de margen sobre el techo diario de 20.000 de Firestore.

Existe una segunda escala, `SCALE_DEMO` de **1.000.000 de documentos, solo
MongoDB** (101 MB medidos de los 512 disponibles). En Firestore, un millón de
documentos serían **50 días** de cupo.

## Cómo se garantiza que los registros sean idénticos

**El generador es una función pura del índice, no un PRNG con semilla.** Un PRNG
guarda estado: el documento 500 dependería de haber generado el 499, y reanudar
una siembra cortada produciría datos distintos a una corrida limpia. Las dos bases
dejarían de ser idénticas **en silencio**.

Tres decisiones más, cada una por un fallo concreto que evita:

- **Las fechas son milisegundos, no `Date`.** Mongo guarda BSON datetime y
  Firestore su propio `Timestamp` con nanosegundos: al releerlos serían objetos
  distintos y el criterio de identidad fallaría **al leer**, no al escribir.
- **`orderItems` lleva `categoryId` denormalizado**, porque Firestore no puede
  hacer JOIN para llegar a él. La verificación comprueba que coincida con la
  categoría real del producto: si no coincidiera, el `$lookup` de Mongo y la
  agregación de Firestore estarían respondiendo **preguntas distintas**.
- **La siembra es idempotente**: todo *upsert* sobre un `_id` determinista.
  Verificado sembrando dos veces y **contando en la base**.

Verificación previa a escribir un solo byte:

```bash
node --experimental-strip-types scripts/check-dataset.mjs
```

## Reproducir el benchmark completo

```bash
# 0. Credenciales
cp .env.example .env      # y completar
node scripts/check-env.mjs                 # forma del .env y parseo de la llave
node scripts/check-mongo.mjs               # conectividad MongoDB
node scripts/check-firestore.mjs           # conectividad Firestore

# 1. Verificar el generador ANTES de escribir
node --experimental-strip-types scripts/check-dataset.mjs

# 2. Sembrar las dos bases (18.000 pareados)
node --experimental-strip-types --env-file=.env scripts/seed.mjs --scale=paired
node --experimental-strip-types --env-file=.env scripts/seed.mjs --engine=firestore

# 3. Indices compuestos de Firestore
node --experimental-strip-types --env-file=.env scripts/firestore-indexes.mjs --deploy

# 4. La escala de 1.000.000 (solo MongoDB)
node --experimental-strip-types --env-file=.env scripts/seed.mjs --scale=demo

# 5. Medir: interfaz
npm run dev        # elegir motores, operaciones y consultas en la consola

# 6. Medir: pruebas sensitivas
node scripts/sensitivity.mjs --engine=mongodb --out=sensibilidad.json
```

Condiciones de cada medición: panel **Condiciones de la medición** en la
aplicación, o `GET /api/context`. **Nunca se cachea.**

---

# Elementos de presentación y demostración

| Elemento | Dónde | Qué muestra |
|---|---|---|
| **Consola en vivo** | `/` | selección de motores, operaciones y consultas; progreso muestra a muestra por SSE |
| **Tabla de resultados** | `/` | p50/p95/media/máx/rendimiento/errores por fase, con tooltips que definen cada métrica |
| **Gráfico comparativo** | `/` | p95 por operación y motor, **escala logarítmica** |
| **Panel de condiciones** | `/` | red, tamaño y parámetros de cada motor, medidos en vivo |
| **Página de divulgación** | `/proyecto` | arquitectura, método, decisiones, glosario y límites, con 3 diagramas SVG |
| **Documento de análisis** | `ANALISIS.md` | los nueve criterios del enunciado, con lo que cada motor NO permite medir |
| **Guion de presentación** | `PRESENTACION.md` | láminas con qué decir y qué mostrar |
| **Datos crudos** | `sensibilidad.json` | resultados completos de los barridos, reprocesables |

**El gráfico usa escala logarítmica a propósito.** Firestore ~130 ms contra Mongo
~54 ms todavía se ve bien en escala lineal, pero contra los 2 ms del trabajo real
del motor una barra sería una raya invisible.

**La demostración en vivo es el elemento central**: la corrida transmite muestra a
muestra, así que la audiencia ve el benchmark ejecutándose contra bases reales, no
una captura de pantalla.
