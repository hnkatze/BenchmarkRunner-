# Análisis — Firestore vs MongoDB

Estudio comparativo de dos bases documentales no relacionales sobre estructuras
idénticas, en sus capas gratuitas.

**Todos los números de este documento fueron medidos**, no estimados. Cada uno
indica cómo se obtuvo y bajo qué condiciones. Donde un motor no permite medir
algo, se dice explícitamente en vez de rellenar con un cero.

---

## 0. La tesis

Nos propusimos comparar Firestore y MongoDB de forma justa. **Descubrimos que no
se puede**, y ese es el resultado del trabajo.

Cuatro hallazgos lo sostienen, todos verificables:

1. **Firestore no tiene `GROUP BY`, `HAVING`, `JOIN` ni subconsultas.** Cinco de
   las diez consultas del enunciado no existen ahí. Corren porque les escribimos
   el motor que falta a mano.
2. **Un millón de registros es imposible en el plan gratuito de Firestore.**
   20.000 escrituras por día son 50 días. No es lentitud: es un techo.
3. **No hay parámetros de cluster que igualar.** Firestore es serverless y no
   expone ninguno.
4. **Firestore no informa cuánto pesa.** MongoDB lo responde con una llamada.

Un informe que presentara una tabla de milisegundos sin estas cuatro cosas
estaría mintiendo por omisión.

---

## 1. Estructura: 8 colecciones idénticas

Modelo de comercio, elegido porque produce preguntas de agrupación naturales sin
forzarlas y porque tiene cinco relaciones reales — que es lo que hace visible la
ausencia de `JOIN` en Firestore.

| Colección | Rol | Relaciones |
|---|---|---|
| `categories` | catálogo | — |
| `suppliers` | catálogo | — |
| `products` | catálogo | → `categories`, `suppliers` |
| `customers` | maestro | — |
| `orders` | transaccional | → `customers` |
| `orderItems` | **tabla de hechos** | → `orders`, `products`, `categories` |
| `payments` | transaccional | → `orders` |
| `reviews` | transaccional | → `products`, `customers` |

### Cómo se garantiza que los registros sean idénticos

El generador es una **función pura del índice**, no un PRNG con semilla.

Un PRNG guarda estado: el documento 500 dependería de haber generado el 499. Si
una siembra se corta a la mitad y se reanuda, produciría datos distintos a una
corrida limpia, y **las dos bases dejarían de ser idénticas sin que nadie se
entere**. Con un hash entero es índice → documento, sin memoria.

Verificado en `scripts/check-dataset.mjs`: generar `[0,60)` y reanudar desde `30`
coinciden exactamente, en las 8 colecciones.

**Las fechas son milisegundos, no `Date`.** MongoDB guarda un `Date` como BSON
datetime y Firestore como su propio `Timestamp` con nanosegundos. Al releerlos
serían objetos distintos: el criterio de identidad fallaría **al leer**, no al
escribir, que es la peor forma de fallar.

**`orderItems` lleva su `categoryId` copiado** porque Firestore no puede hacer
`JOIN` para llegar a él. La verificación comprueba que esa copia coincida con la
categoría real del producto. Si no coincidiera, el `$lookup` de MongoDB y la
agregación por grupo de Firestore estarían respondiendo **preguntas distintas**,
y los números se verían perfectos sin significar nada.

---

## 2. Los límites de las capas gratuitas

| | MongoDB Atlas M0 | Firestore Spark |
|---|---|---|
| Almacenamiento | **512 MB** | **1 GiB** |
| Escrituras | sin cupo | **20.000 / día** |
| Lecturas | sin cupo | **50.000 / día** |
| Borrados | sin cupo | **20.000 / día** |
| CPU / RAM | compartida | no aplica |
| Conexiones | 500 | no aplica |

### Lo posible y lo imposible

**Un millón de registros en Firestore es imposible.**

```
1.000.000 ÷ 20.000 escrituras/día = 50 días
```

En el plan Blaze costaría unos USD 1,80. En Spark no hay forma.

**En MongoDB sí es posible, y sobra espacio.** Medido insertando 20.000
documentos reales en el M0 y leyendo `collStats`:

| Medición | Valor |
|---|---:|
| Tamaño BSON sin comprimir | 274 B |
| Compresión WiredTiger | **5,01×** |
| Bytes por documento **con 3 índices** | **106 B** |
| Proyección de 1.000.000 | **101 MB** de 512 |
| Capacidad total estimada | ~5.000.000 documentos |

**El almacenamiento no era el límite. El cupo de escrituras sí.**

### La trampa de los borrados

Borrar también consume cupo. Rehacer una siembra de 18.000 en Firestore cuesta
un día de borrados **más** otro de escrituras: **hay un intento por día, no dos**.

Por eso el seeder es idempotente y reanudable desde el diseño, no como parche
después del primer accidente.

### Las dos escalas que sí se pueden

| Escala | Documentos | Motores | Por qué |
|---|---:|---|---|
| **Pareada** | 18.000 | ambos | Dimensionada por el cupo diario, con 2.000 de margen |
| **Demostración** | 1.000.000 | solo MongoDB | Cumple el mínimo del enunciado; Firestore serían 50 días |

Reparto de la escala pareada: `orderItems` 11.000 · `orders` 3.500 ·
`reviews` 1.700 · `customers` 900 · `payments` 700 · `products` 150 ·
`suppliers` 40 · `categories` 10.

La tabla de hechos se lleva el 61% porque **ahí viven los `GROUP BY … HAVING`**.

---

## 3. Datos de red

Mediana de 7 muestras, medida desde el servidor de la aplicación en Honduras.

| Motor | Mediana | Mín | Máx | Destino |
|---|---:|---:|---:|---|
| MongoDB Atlas | **46 ms** | 45 | 47 | `equipo4.iawiuqr.mongodb.net` |
| Firestore | **158 ms** | 108 | 214 | `nam5`, multirregión |

**Firestore tiene 3,4× el piso de red de MongoDB desde acá**, y una dispersión
mucho mayor (108–214 contra 45–47). Ese piso está debajo de **cada** número de
latencia de este informe.

Consecuencia directa: si una operación de MongoDB mide 50 ms, unos 46 son viaje.
El motor cuesta 4. **Ninguna diferencia menor al piso de red es atribuible al
motor.**

El panel de "Condiciones de la medición" en la aplicación reporta esto en vivo,
junto al tamaño y a los parámetros, para que ningún número se lea sin ellos.

---

## 4. Tamaño de las bases, antes y después

### MongoDB — medido por API (`dbStats` / `collStats`)

| | Antes | Después de 18.000 |
|---|---:|---:|
| Documentos | 0 | 18.000 |
| Datos | 0 MB | **3,17 MB** |
| En disco | 1,76 MB | **4,14 MB** |
| Índices | 1,15 MB | **2,73 MB** |
| Total | 2,91 MB | **6,87 MB** de 512 |

**Los índices pesan el 66% de los datos.** Con 15 índices compuestos sobre
18.000 documentos, casi dos tercios del espacio no son información: son la
estructura que permite encontrarla.

### Firestore — no se puede medir por API

**Ningún método del SDK devuelve el tamaño de la base.** Sale de la consola de
Firebase o de la API de Cloud Monitoring.

Y hay razones para esperar que sea peor: **Firestore indexa cada campo
automáticamente**. Para un documento de 12 campos, el índice suele pesar más que
el dato. El GiB gratuito se agota mucho antes de lo que sugiere el tamaño de los
documentos.

Esta asimetría es un resultado: **uno de los dos motores permite auditar su
propio consumo y el otro no.**

---

## 5. Creación de colecciones e índices

### MongoDB — medible, y medido

15 índices sobre las 8 colecciones, creados **después** de los datos y
cronometrados por separado.

```
15 índices en 1.719 ms   (107–135 ms cada uno)
```

Se crean después a propósito: hacerlo antes obligaría a cada escritura a
mantenerlos, **inflando el número de siembra y desinflando el de indexación**. El
enunciado pide los dos, así que no pueden contaminarse.

### Firestore — no aplica, por tres razones distintas

1. **Las colecciones no se crean.** Nacen cuando se escribe el primer documento.
   No hay `CREATE`, así que "cuánto tarda crear la tabla" es cero por definición.
2. **Los índices de campo simple son automáticos.** Nunca se declaran.
3. **Los compuestos no se pueden crear desde el SDK.** Se declaran en
   `firestore.indexes.json`, se despliegan con la CLI y **se construyen en
   background**. No hay momento del cliente que cronometrar.

Para que los dos motores queden en igualdad de condiciones, `firestore.indexes.json`
se **genera desde la misma tabla** que usa MongoDB (9 compuestos a declarar, 6 que
Firestore ya cubre solo). Una copia escrita a mano se desalinearía en el primer
cambio, y estaríamos comparando un motor indexado contra uno que no.

---

## 6. Velocidad de siembra

18.000 documentos en la escala pareada, contra el M0 real:

```
Total                    28,7 s
orderItems (11.000)      1.226 docs/s
orders (3.500)             497 docs/s
reviews (1.700)            426 docs/s
```

Contra **366 docs/s** midiendo con lotes secuenciales: **3,3× solo por
concurrencia**, con 8 lotes en vuelo.

Eso confirma lo mismo que la sección de red: **el costo es el viaje, no el
servidor**. Un lote de 1.000 documentos tarda casi lo mismo que uno de 100, así
que lo que paga es el número de idas y vueltas.

La proyección para 1.000.000 en MongoDB es de unos 46 minutos secuencial, y
menos de 10 con concurrencia.

---

## 7. Las diez consultas de lectura

Cinco simples y cinco complejas con subconsultas y `HAVING`.

Están declaradas **como datos**, no como código dentro de cada adaptador, porque
los dos motores responden por medios completamente distintos y lo único que
mantiene honesta la comparación es que estén respondiendo **la misma pregunta**.

### Las cinco simples — nativas en ambos

| # | Pregunta | Firestore |
|---|---|---|
| 1 | Los 50 productos más caros de una categoría | nativa |
| 2 | Historial de pedidos de un cliente | nativa |
| 3 | Pedidos por estado en una ventana de fechas | nativa |
| 4 | Clientes de un segmento en un país | nativa |
| 5 | Reseñas de un producto sobre un umbral | nativa |

### Las cinco complejas — ninguna existe en Firestore

| # | Pregunta | MongoDB | Firestore |
|---|---|---|---|
| 6 | Categorías con facturación sobre un umbral | `$group` + `$match` | **una agregación por grupo** |
| 7 | Ticket promedio teniendo más de N líneas | `$group` + `$match` | **una agregación por grupo** |
| 8 | Pedidos entregados con su cobro | `$lookup` | **unión en el cliente, N+1 viajes** |
| 9 | Clientes que gastaron más que el promedio | `$facet` | **dos pasadas secuenciales** |
| 10 | Productos mejor calificados que la media | `$lookup` + `$facet` | **dos pasadas secuenciales** |

MongoDB resuelve cada una en **un solo viaje al servidor**. Firestore necesita
entre 2 y 51.

### El hallazgo central: el `GROUP BY` de Firestore no generaliza

Para agrupar, Firestore obliga a **enumerar los grupos de antemano** y lanzar una
consulta de agregación por cada uno.

Con 10 categorías funciona. Con `GROUP BY customerId` serían 900 viajes. Con una
clave de cardinalidad no acotada **es imposible**.

No es que Firestore sea lento agrupando. **Es que no agrupa**, y lo que corre en
su lugar es código de aplicación que escribimos nosotros.

### El costo de lectura decidió el diseño

Las agregaciones de Firestore se cobran **1 lectura por cada 1.000 entradas de
índice**, no una por documento. Eso cambia todo:

| Estrategia | Lecturas/día | Contra el cupo de 50.000 |
|---|---:|---|
| Traer los documentos y agrupar en JS | 1.800.000 | **36× por encima. Inviable.** |
| Una agregación por grupo | 3.000 | 6%. Viable. |

**600× de diferencia.** La emulación ingenua agotaría el cupo diario en una sola
corrida.

### Resultados medidos — MongoDB, 18.000 documentos

5 iteraciones por consulta, 1 de calentamiento, concurrencia 1, **0 errores en
las 10 fases**.

| Consulta | p50 | p95 |
|---|---:|---:|
| Productos por categoría | 44,74 | 45,23 |
| Pedidos de un cliente | 44,62 | 50,29 |
| Pedidos por estado y fecha | 44,95 | 53,86 |
| Clientes por segmento | 44,47 | 44,87 |
| Reseñas de un producto | 44,31 | 45,02 |
| **Facturación por categoría** | **51,22** | 51,74 |
| **Ticket promedio por categoría** | **54,00** | 59,35 |
| **Pedidos unidos a cobros** | **46,20** | 46,59 |
| **Clientes sobre el promedio** | **53,65** | 59,12 |
| **Productos mejor calificados** | **49,36** | 60,63 |

Las simples se agrupan en 44–45 ms; las complejas suben a 46–54 ms.

**Sobre un piso de red de 46 ms, eso significa que el trabajo real del motor es
de 0 a 8 ms.** El pipeline de agregación de MongoDB, sobre 18.000 documentos,
casi no cuesta.

> **Firestore no está sembrado.** Sembrar consume el cupo del día, y esa decisión
> es del operador. Los adaptadores están escritos y verificados en seco; la tabla
> comparativa se completa en la corrida siguiente a la siembra.

---

## 8. Parámetros: no hay simetría, y esa es la respuesta

| | MongoDB Atlas | Firestore |
|---|---|---|
| Tier | M0 compartido | **no existe** |
| CPU / RAM | compartida | **no expuesta** |
| Conexiones | 500 | **no aplica** |
| Topología | replica set de 3 nodos | **no expuesta** |
| Versión | 8.0.32 | no versionada al usuario |
| Motor | WiredTiger | no expuesto |
| Ubicación | región única | `nam5`, multirregión |
| Modo | — | Native |

**No se pueden "igualar los parámetros de cluster", porque Firestore no tiene
ninguno.** Es serverless: no se elige CPU, ni RAM, ni nodos.

Lo único honesto es **declarar los dos lados completos** y decir en voz alta que
la comparación es entre un tier compartido y un servicio sin tier.

Y hay una asimetría más, que agranda la brecha en escrituras: **`nam5` es
multirregión**. Cada escritura de Firestore replica entre regiones de EE. UU.
antes de confirmarse. No es comparable contra un cluster de región única sin
decirlo.

---

## 9. Conclusiones

**1. Ninguna diferencia menor a 46 ms es atribuible al motor.** Ese es el piso de
red hacia MongoDB desde Honduras; hacia Firestore es 158 ms. Cualquier informe
que compare estas bases sin declarar su latencia de red está midiendo geografía.

**2. Los índices no son gratis.** El 66% del espacio ocupado en MongoDB son
índices. Firestore, que indexa todo automáticamente, paga más y no permite
medirlo.

**3. Firestore no es una base de datos con menos funciones. Es un modelo
distinto.** Sin agrupación, sin uniones y sin subconsultas, la lógica que un
motor relacional resuelve en una sentencia se muda a la aplicación. Eso se puede
elegir a conciencia — pero hay que saberlo antes, no descubrirlo con el proyecto
a medio hacer.

**4. Las capas gratuitas no son una versión chica del producto.** Son un producto
distinto, con techos que cambian qué es posible construir. 20.000 escrituras por
día no es "un poco menos": es la diferencia entre poder sembrar un millón de
registros y no poder.

**5. Comparar sin igualar condiciones es peor que no comparar.** Igualamos los
índices declarándolos una vez para los dos motores, igualamos los datos con un
generador determinista, e igualamos las preguntas declarando las consultas como
datos. Lo que **no** se pudo igualar está enumerado, no escondido.

---

## Cómo reproducir

```bash
# 1. Verificar el generador antes de escribir nada
node --experimental-strip-types scripts/check-dataset.mjs

# 2. Sembrar (18.000 pareados)
node --experimental-strip-types --env-file=.env scripts/seed.mjs --scale=paired
node --experimental-strip-types --env-file=.env scripts/seed.mjs --engine=firestore

# 3. Índices de Firestore
node --experimental-strip-types scripts/firestore-indexes.mjs --write
firebase deploy --only firestore:indexes

# 4. La escala de 1.000.000 (solo MongoDB)
node --experimental-strip-types --env-file=.env scripts/seed.mjs --scale=demo

# 5. Medir: npm run dev, y en la consola elegir motores y consultas
```

Condiciones de cada medición: panel **"Condiciones de la medición"** en la
aplicación, o `GET /api/context`.
