# Guion de presentación — Proyecto II

**Benchmark Firestore vs. MongoDB Atlas**

Documento de trabajo para armar las láminas. Cada lámina trae:

- **En pantalla** — lo que va escrito en la diapositiva. Poco texto, a propósito.
- **Qué decir** — el guion hablado. No se lee: se cuenta.
- **Mostrar** — qué figura, tabla o demo acompaña.

**Duración objetivo: 15 minutos + 5 de preguntas.** El reparto sugerido está al
final.

> **La regla de oro de esta presentación:** la audiencia se va a acordar de UNA
> idea. Que sea esta — **la mayor parte de la diferencia entre los dos motores,
> medida desde Honduras, es distancia, no motor.** Todo lo demás cuelga de ahí.

---

## Bloque 0 · Apertura (2 min)

### Lámina 1 — Portada

**En pantalla**
- Benchmark de Bases de Datos
- Cloud Firestore vs. MongoDB Atlas
- Integrantes · Clase · Fecha

**Qué decir**
> "Comparamos dos bases de datos midiendo contra instancias reales en la nube,
> no simuladas. Todo lo que van a ver salió de una corrida contra Firestore y
> contra un cluster de MongoDB Atlas."

---

### Lámina 2 — La pregunta

**En pantalla**
- ¿Cuál es más rápida?
- ~~¿Cuál es más rápida?~~ *(tachado)*
- **¿Qué puede medir cada una, y qué no?**

**Qué decir**
> "Arrancamos queriendo saber cuál era más rápida. A la semana nos dimos cuenta
> de que esa pregunta, sola, produce un número que miente. La pregunta buena
> resultó ser otra: **qué puede hacer cada motor, qué no puede, y qué ni siquiera
> permite medir.**"

**Mostrar** — la palabra tachada apareciendo en vivo. Es el gancho.

---

### Lámina 3 — Qué NO es este benchmark

**En pantalla**
- No mide costo operativo
- No mide facilidad de desarrollo
- No mide sincronización en tiempo real
- **Mide: latencia, capacidad de carga, tamaño y cobertura de consultas**

**Qué decir**
> "Declarar el alcance por adelantado es parte del método. Firestore gana en
> cosas que nosotros no medimos, y lo vamos a decir explícitamente cuando
> lleguemos a las recomendaciones."

---

## Bloque 1 · Cómo lo medimos (4 min)

### Lámina 4 — La herramienta

**En pantalla**
- **BenchmarkRunner** — aplicación propia
- Astro 7 + TypeScript estricto · sin framework de UI
- La medición corre en el **servidor**; el navegador nunca ve credenciales
- Transmisión **muestra a muestra** por Server-Sent Events

**Qué decir**
> "No usamos YCSB ni un script suelto. Ninguna herramienta genérica responde
> *qué no puede hacer el motor*: para eso hay que implementar las mismas
> preguntas de negocio en los dos y ver cuál se rompe."

---

### Lámina 5 — La decisión de arquitectura

**En pantalla**

```ts
export type BenchmarkRunner = {
  readonly plannedSamples: (config) => number
  readonly run: (config, signal) => AsyncIterable<RunEvent>
}
```

- Firestore, MongoDB, las consultas y el multi-motor: **todos** lo implementan
- Para la medición, **una consulta es igual que una operación**

**Qué decir**
> "Un solo puerto. Cambiar del adaptador simulado al de Firestore fue **una
> línea**. Y cuando agregamos las diez consultas del dataset, la tabla, el
> gráfico y los percentiles funcionaron sin tocar nada: para el que mide, una
> consulta es *corré esto N veces y devolveme las latencias*."

**Mostrar** — diagrama `PortDiagram` de la página `/proyecto`.

---

### Lámina 6 — Los datos: 18.000 registros idénticos

**En pantalla**
- 8 colecciones · 18.000 documentos · **idénticos en las dos bases**
- Generador = **función pura del índice**, no un PRNG con semilla
- Fechas en milisegundos, no `Date`
- Siembra idempotente, verificada **contando en la base**

**Qué decir**
> "Si los datos no son idénticos, no hay comparación. Usamos una función pura del
> índice: el documento 500 no depende de haber generado el 499. Con un generador
> con semilla, reanudar una siembra cortada produciría datos distintos **y nadie
> se enteraría**."

**Mostrar** — tabla de las 8 colecciones con sus conteos.

---

### Lámina 7 — Igualar condiciones

**En pantalla**
- Índices declarados **una vez para los dos motores**
- Las 10 consultas declaradas **como datos**, con su enunciado
- Índices creados **después** de los datos y cronometrados aparte
- Lo que **no** se pudo igualar: enumerado, no escondido

**Qué decir**
> "Si cada adaptador eligiera sus propios índices, estaríamos midiendo una
> decisión de indexación, no un motor. Y si creáramos los índices antes de los
> datos, inflaríamos el número de carga y desinflaríamos el de indexación. El
> enunciado pide los dos: no pueden contaminarse."

---

## Bloque 2 · El hallazgo que cambia todo (2 min)

### Lámina 8 — El piso de red

**En pantalla**

| Motor | Mediana | Rango |
|---|---:|---|
| MongoDB Atlas | **46 ms** | 45 – 51 |
| Firestore (`nam5`) | **105 – 158 ms** | 97 – 214 |

> **Ninguna diferencia menor a 46 ms es atribuible al motor.**

**Qué decir**
> "Esta es la lámina más importante de la presentación. Desde Honduras, antes de
> que la base haga absolutamente nada, ya se fueron 46 milisegundos hacia
> MongoDB y más de 100 hacia Firestore. **Ese piso está debajo de todos los
> números que siguen.** Un informe que compare estas bases sin declararlo está
> midiendo geografía y llamándolo rendimiento."

**Mostrar** — panel *Condiciones de la medición*, en vivo. Que se vea que se
mide en el momento y **no se cachea**.

---

## Bloque 3 · Resultados (4 min)

### Lámina 9 — CRUD: latencia p95

**En pantalla**

| | insertOne | findById | queryFiltered | updateOne | deleteOne |
|---|---:|---:|---:|---:|---:|
| Firestore | 127,8 | 99,7 | 154,9 | 120,2 | 113,5 |
| MongoDB | 54,3 | 52,1 | 52,7 | 55,8 | 56,1 |
| Cociente | 2,4× | 1,9× | 2,9× | 2,2× | 2,0× |

30 iteraciones · 1.024 B · concurrencia 1 · **0 errores**

**Qué decir**
> "MongoDB gana las cinco. Pero miren los cocientes: si el motor dominara, la
> brecha en **escrituras** —donde Firestore replica entre regiones antes de
> confirmar— tendría que ser mucho mayor que en **lecturas**. Va de 1,9 a 2,9 sin
> ningún patrón. Un factor común a todas las operaciones es lo que manda: **la
> red**. Descontando el piso, el trabajo real de MongoDB son 2 a 6 milisegundos."

**Por qué p95 y no promedio**
> "Usamos p95 porque la media esconde la cola, y la cola es lo que el usuario
> siente."

---

### Lámina 10 — Inserción en volumen

**En pantalla**
- 18.000 documentos en **28,7 s**
- Pico: **1.226 docs/s** (`orderItems`)
- Secuencial, sin concurrencia: **366 docs/s**
- **3,3× solo por poner 8 lotes en vuelo**

**Qué decir**
> "Un lote de mil documentos tarda casi lo mismo que uno de cien. Lo que se paga
> es el **número de idas y vueltas**, no los bytes. Misma conclusión que la
> lámina del piso de red, por otro camino."

---

### Lámina 11 — Tamaño de las bases

**En pantalla**

| MongoDB | Antes | Después |
|---|---:|---:|
| Datos | 0 | 3,17 MB |
| Índices | 1,15 MB | 2,73 MB |
| **Total** | 2,91 MB | **6,87 MB** de 512 |

- **Los índices pesan el 66 % de los datos**
- Firestore: **ningún método del SDK devuelve el tamaño**

**Qué decir**
> "Dos tercios del espacio no son información: son la estructura para
> encontrarla. Y acá aparece la primera asimetría dura: **Firestore no permite
> preguntarle cuánto ocupa.** Eso no es un detalle técnico, es una propiedad
> operativa. Uno de los dos motores permite auditar su propio consumo y el otro
> no."

---

### Lámina 12 — Las 10 consultas

**En pantalla**
- 5 simples → **44 – 45 ms** (piso de red: 46)
- 5 complejas → **46 – 54 ms**
- **0 errores en las 10 fases**
- Trabajo real del motor: **0 a 8 ms**

**Qué decir**
> "El pipeline de agregación de MongoDB sobre 18.000 documentos casi no cuesta.
> Ocho milisegundos de trabajo real para agrupar, unir y filtrar."

---

### Lámina 13 — La asimetría: 5 de 10 no existen

**En pantalla**

| | MongoDB | Firestore |
|---|---|---|
| `GROUP BY` / `HAVING` | nativo | **no existe** |
| `JOIN` | nativo | **no existe** |
| Subconsultas | nativo | **no existe** |

> 5 de las 10 consultas corren en Firestore **porque les escribimos el motor que
> falta, a mano**.

**Qué decir**
> "Este es el hallazgo central del proyecto. Firestore no es una base con menos
> funciones: **es un modelo distinto**. La lógica que un motor relacional
> resuelve en una sentencia se muda a la aplicación. Se puede elegir a
> conciencia — pero hay que saberlo antes, no descubrirlo con el proyecto a
> medio hacer."

**El dato que sorprende**
> "Emular un `GROUP BY` trayendo todo costaría 1.800.000 lecturas por día:
> **36 veces el cupo**. Con agregaciones por grupo cuesta 3.000. Seiscientas
> veces menos — pero exige conocer la cardinalidad de antemano, así que **no
> generaliza**."

---

## Bloque 4 · Pruebas sensitivas (3 min)

### Lámina 14 — Por qué hacemos pruebas sensitivas

**En pantalla**
- Una tabla de latencias dice **cuán rápido es**
- No dice **cuánto puedo confiar en ese número**
- Método: mover **un** parámetro, dejar fijos los demás

**Qué decir**
> "Movimos concurrencia, tamaño de documento y número de iteraciones, de a uno."

---

### Lámina 15 — Concurrencia: el codo

**En pantalla**

| Concurrencia | p50 | p95 | Rendimiento |
|---:|---:|---:|---:|
| 1 | 53,50 | 55,18 | 18,6 op/s |
| 4 | 53,87 | 55,23 | 69,1 op/s |
| 8 | 54,16 | 55,81 | **135,6 op/s** |
| 16 | 55,86 | **245,37** | **68,6 op/s** |

**Qué decir**
> "Hasta 8, el rendimiento se multiplica por 7,3 mientras la latencia se mueve
> **1,2 %**. A 16 el sistema se cae: el p95 se multiplica por cuatro y el
> rendimiento **se parte a la mitad**. Un M0 comparte CPU; pasado el codo, la
> contención cuesta más de lo que el paralelismo gana. **Ese codo hay que
> buscarlo, no suponerlo.**"

**El bonus técnico**
> "Y acá probamos algo que casi todo informe hace mal: la métrica `opsPerSecond`
> que devuelven las librerías es **la inversa de la media**. Se quedó clavada en
> 18,6 mientras el rendimiento real subía 7,3 veces. **Latencia y rendimiento son
> preguntas distintas; derivar una de la otra da un número que se mueve al
> revés.**"

---

### Lámina 16 — Tamaño e iteraciones

**En pantalla**

**Tamaño del documento** — 16× el payload mueve el p50 un **0,4 %**
*(recién a 16 KB aparece: +18 % en p95)*

**Iteraciones** — p50 estable desde **10**; p95 necesita **100**; el máximo
**nunca converge**

**Qué decir**
> "El tamaño no es una variable de confusión en el rango que usamos: confirma que
> el costo es el viaje. Y sobre iteraciones sacamos una regla operativa: reportar
> el máximo como métrica es un error, porque crece con la cantidad de muestras
> por definición."

---

## Bloque 5 · Cierre (3 min)

### Lámina 17 — KPI

**En pantalla** — los cinco más elocuentes:

| KPI | Umbral | MongoDB | Firestore |
|---|---|---|---|
| Latencia de escritura p95 | < 100 ms | 54,3 ✅ | 127,8 ❌ |
| Sobrecosto del motor | < 15 ms | 2–6 ms ✅ | sin dato |
| Índice / dato | < 1,0 | 0,86 ✅ | **no auditable** ❌ |
| Cobertura funcional | 10/10 | 10/10 ✅ | **5/10** ❌ |
| Autonomía de operación | sí | sí ✅ | **no** ❌ |

**Qué decir**
> "Los dos últimos son los que aportan algo que una tabla de latencias no dice.
> *Sobrecosto del motor* separa el motor de la geografía. *Autonomía* mide si el
> motor permite auditarse."

---

### Lámina 18 — El líder, con su salvedad

**En pantalla**
- Líder medido: **MongoDB Atlas**
- Gana las 5 operaciones CRUD y completa las 10 consultas
- **Pero la mayor parte de esa ventaja es geografía**
- Lo que sobrevive a cualquier región: `GROUP BY`, `JOIN`, subconsultas, auditoría

**Qué decir**
> "Decimos que gana MongoDB, y en la misma lámina decimos por qué ese resultado
> es más chico de lo que parece. Desplegando la función en Virginia, los dos
> pisos bajan y los cocientes cambian. Lo que **no** cambia es que cinco de las
> diez consultas no existen en Firestore."

---

### Lámina 19 — Recomendaciones

**En pantalla**

| Escenario | Motor |
|---|---|
| Reportería y analítica | **MongoDB** |
| Auditoría de consumo | **MongoDB** |
| Cargas masivas de escritura | **MongoDB** |
| App móvil con sincronización en vivo | **Firestore** |
| Escala impredecible sin DBA | **Firestore** |

**Qué decir**
> "Firestore no perdió: **no compitió** en lo que hace bien. Escala automática sin
> operación, seguridad declarativa, tiempo real con el cliente. Este proyecto
> midió latencia y capacidad analítica; no midió costo operativo, y ahí el orden
> se invierte."

---

### Lámina 20 — Lo que no pudimos medir

**En pantalla**
- Dataset de Firestore: **no sembrado**
- Motivo: **`RESOURCE_EXHAUSTED` — cupo diario agotado**
- 20.000 escrituras/día · sembrar cuesta 18.000 · **un intento por día**
- Tamaño de Firestore: **no medible por API**, nunca

**Qué decir**
> "Y lo decimos en la presentación, no en una nota al pie. Las capas gratuitas no
> son una versión chica del producto: **son un producto distinto**, con techos que
> cambian qué es posible construir. En este proyecto, ese techo **bloqueó una
> medición completa**. Ese también es un resultado."

---

### Lámina 21 — Conclusiones

**En pantalla**
1. Ninguna diferencia menor al piso de red es atribuible al motor
2. Los índices no son gratis — 66 % del espacio
3. Firestore no tiene menos funciones: **tiene otro modelo**
4. Las capas gratuitas cambian qué es posible construir
5. Comparar sin igualar condiciones es **peor** que no comparar

**Qué decir** — leer la 5 y cerrar:
> "Igualamos los índices, los datos y las preguntas. Lo que no se pudo igualar
> está enumerado, no escondido. Ese es el proyecto."

---

## Demostración en vivo

**Cuándo:** después de la lámina 8 (el piso de red) o al final, según el tiempo.
**Duración:** 3 minutos.

### Guion exacto

| # | Acción | Qué señalar |
|---|---|---|
| 1 | `npm run dev`, abrir `/` | ya arrancado antes de presentar |
| 2 | Mostrar el panel **Condiciones de la medición** | "esto se midió hace segundos, no está cacheado" |
| 3 | Marcar **los dos motores**, `insertOne` y `findById`, **10 iteraciones** | pocas iteraciones: tiene que terminar en vivo |
| 4 | Ejecutar | la barra avanza **muestra a muestra**: es SSE real |
| 5 | Señalar la tabla mientras se llena | p50 y p95 aparecen por fase |
| 6 | Señalar el gráfico | "escala logarítmica, si no una barra sería invisible" |
| 7 | Abrir `/proyecto` | diagramas de arquitectura y glosario |

### Configuración segura para la demo

| Campo | Valor | Por qué |
|---|---|---|
| Motores | los dos | es la comparación |
| Operaciones | `insertOne`, `findById` | 2 fases por motor, no 5 |
| Consultas | **ninguna** | Firestore no está sembrado: fallarían |
| Iteraciones | **10** | ~10 s por motor |
| Concurrencia | 1 | la lectura limpia |

> ⚠️ **No marcar "todo"** en la demo. Con todo seleccionado son 30 fases y más de
> diez minutos, y las consultas de Firestore fallan por falta de dataset.
> Si igual se quiere mostrar el fallo, ahora la interfaz **reporta la causa
> mientras corre** en vez de parecer colgada — puede ser un buen momento para
> mencionar el cupo.

### Plan B, si no hay red

Capturas de: panel de condiciones, tabla completa, gráfico p95, y la tabla de
concurrencia de las pruebas sensitivas. Tomarlas **antes** de presentar.

---

## Reparto de tiempo

| Bloque | Láminas | Minutos |
|---|---|---:|
| Apertura | 1 – 3 | 2 |
| Cómo lo medimos | 4 – 7 | 4 |
| El piso de red | 8 | 2 |
| Resultados | 9 – 13 | 4 |
| Pruebas sensitivas | 14 – 16 | 3 |
| Cierre | 17 – 21 | 3 |
| **Demo** | — | 3 |
| **Total** | | **21** |

Si hay que recortar: **fusionar 14 y 16**, y saltar la lámina 3. **No recortar la
lámina 8** — sin ella, todos los números que siguen se leen mal.

---

## Preguntas probables, y su respuesta corta

**"¿Por qué no compararon con la misma región?"**
> Lo hicimos explícito en vez de esconderlo. La función de producción está fijada
> en `iad1` justamente por eso; las mediciones de este informe salieron desde
> Honduras y lo declaramos en cada tabla.

**"¿No es injusto comparar un M0 compartido contra Firestore?"**
> Sí lo es, y por eso declaramos los dos lados completos. Firestore **no tiene**
> tier, ni CPU, ni RAM configurables: no hay forma de igualar parámetros que en
> un motor no existen.

**"¿Por qué p95 y no el promedio?"**
> La media esconde la cola. En las pruebas sensitivas quedó medido: a
> concurrencia 8 el p50 de `findById` no se movió y el p95 se multiplicó por
> cinco. Un solo número habría escondido eso.

**"¿Por qué no sembraron Firestore?"**
> Se intentó. Devolvió `RESOURCE_EXHAUSTED`: el cupo diario de 20.000 escrituras
> ya estaba consumido. Sembrar cuesta 18.000, así que hay un intento por día. El
> adaptador está escrito y verificado.

**"¿Los resultados son reproducibles?"**
> Sí. El generador es determinista, la siembra es idempotente y verificada
> contando en la base, y los comandos exactos están en `PROYECTO-II.md`. Los
> datos crudos de las pruebas sensitivas están en `sensibilidad.json`.
