# DESIGN.md — BenchmarkRunner

Este documento es **vinculante**. Antes de tocar una clase, leerlo.

Está en dos partes:

- **Parte 1 — La referencia.** El sistema Cursor tal como llegó, sin interpretar.
- **Parte 2 — La adaptación.** Qué hace este proyecto distinto y por qué.
  **En cualquier conflicto, gana la Parte 2**, porque describe reglas
  funcionales que el estilo no puede pisar.

---

# Parte 1 — La referencia: Cursor

> Un editor de código con IA cuyo sitio se lee como una marca de herramientas
> para desarrolladores, tranquila y segura, sobre un canvas crema editorial
> (`#f7f7f4`) en vez de la atmósfera oscura habitual de un IDE. La tinta casi
> negra cálida (`#26251e`) carga el cuerpo y el display por igual — el display
> va en peso 400 con tracking negativo, buscando una sensación de revista y no
> una voz tech gritona. El único voltaje de marca es el **naranja Cursor**
> (`#f54e00`), reservado para las acciones primarias y el logotipo. Una paleta
> pastel de línea de tiempo (durazno, menta, azul, lavanda, oro) marca las
> etapas de acción de la IA — **solo dentro de visualizaciones del producto**.
> Las tarjetas usan hairlines mínimos, sin sombras, con un ritmo generoso de
> 80px entre secciones.

**Tema:** claro. **Fuente:** <https://www.cursor.com/>

### Colores

| Token | Valor | Rol |
|---|---|---|
| `--color-cursor-orange` | `#f54e00` | voltaje de marca |
| `--color-cursor-orange-active` | `#d04200` | estado activo |
| `--color-cursor-ink` | `#26251e` | tinta |
| `--color-cursor-body` | `#5a5852` | cuerpo |
| `--color-cursor-muted` | `#807d72` | atenuado |
| `--color-cursor-muted-soft` | `#a09c92` | atenuado suave |
| `--color-cursor-hairline` | `#e6e5e0` | borde |
| `--color-cursor-hairline-soft` | `#efeee8` | borde tenue |
| `--color-cursor-hairline-strong` | `#cfcdc4` | borde marcado |
| `--color-cursor-canvas` | `#f7f7f4` | fondo de página |
| `--color-cursor-canvas-soft` | `#fafaf7` | fondo elevado |
| `--color-cursor-card` | `#ffffff` | superficie de tarjeta |
| `--color-cursor-surface-strong` | `#e6e5e0` | superficie marcada |
| `--color-cursor-on-primary` | `#ffffff` | texto sobre naranja |

**Paleta de línea de tiempo** — durazno `#dfa88f`, menta `#9fc9a2`, azul
`#9fbbe0`, lavanda `#c0a8dd`, oro `#c08532`.
**Semánticos** — error `#cf2d56`, éxito `#1f8a65`.

### Tipografía

CursorGothic para display y cuerpo (sustituto declarado: **Inter**).
JetBrains Mono en toda superficie de código.

| Rol | Tamaño | Interlínea | Tracking |
|---|---|---|---|
| `display-mega` | 72px | 1.1 | -2.16px |
| `display-lg` | 36px | 1.2 | -0.72px |
| `display-md` | 26px | 1.25 | -0.325px |
| `display-sm` | 22px | 1.3 | -0.11px |
| `title-md` | 18px | 1.4 | 0 |
| `title-sm` / `body-md` | 16px | 1.4 / 1.5 | 0 |
| `body-sm` | 14px | 1.5 | 0 |
| `caption` / `code` | 13px | 1.4 / 1.5 | 0 |
| `caption-uppercase` | 11px | 1.4 | 0.88px |
| `button` | 14px | 1 | 0 |

### Formas

Espaciado 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / **80px de sección**.
Radios 0 / 4 / 6 / **8 (controles)** / **12 (tarjetas)** / 16 / pastilla.
Padding de tarjeta 24px. Ancho máximo de contenido 1200px. **Sin sombras.**

### Reglas de la referencia

**Sí:** usar `--color-primary` para la interacción primaria; anclar las
superficies a `--color-canvas`; preservar tamaño, interlínea y tracking de cada
estilo tipográfico.

**No:** introducir colores fuera del set documentado; reemplazar
`--color-ink` por un neutro arbitrario; aplanar los estados y las relaciones de
espaciado documentadas.

---

# Parte 2 — La adaptación de BenchmarkRunner

**Esta parte gana.** Cursor es un sitio de marketing para un editor. Esto es un
instrumento de medición con una tabla densa, un gráfico y una página de
divulgación. Donde el sistema y la función chocan, manda la función — y cada
desvío está justificado acá, no improvisado en el markup.

## 1. La acción primaria es tinta, no naranja

Cursor pone el naranja en `button primary`. Acá **no**.

El naranja es la identidad de Firestore en el gráfico, la tabla y la leyenda.
Un botón del mismo color haría que el gráfico mienta: el lector asociaría ese
naranja a una acción y no a un motor.

La salida está dentro del propio sistema: Cursor documenta un `button download`
con fondo `ink` y texto `canvas`. **Esa es la acción primaria de esta app.**
Vive en `src/ui/button-recipes.ts` y no se construye por interpolación.

## 2. Los colores de motor son colores de dato

Excepción deliberada a *"no introducir colores fuera del set"*.

Cursor ya establece el precedente: su paleta de línea de tiempo existe
**únicamente dentro de visualizaciones**, nunca como chrome. Los motores son lo
mismo — identifican un dato, no una marca.

| Token | Valor | Contraste sobre `#f7f7f4` |
|---|---|---|
| `--color-firestore` | `#f54e00` (naranja Cursor) | **3.28:1** |
| `--color-mongodb` | `#524ae9` (lavanda a saturación legible) | **5.57:1** |

**Los pastel de línea de tiempo NO pueden ser series de gráfico.** Están
calibrados como relleno de pastilla con texto tinta encima: `timeline-read`
mide **1.84:1** contra el canvas, muy por debajo del 3:1 que exige un objeto
gráfico. Medir antes de proponer uno.

Estos dos tokens **no se reutilizan en la UI**. El color es el identificador
del motor; gastarlo en un borde o un ícono decorativo lo desgasta.

## 3. El mono no es decorativo

`--font-mono` es JetBrains Mono y carga **toda columna numérica**, con `.tnum`.
Sin cifras tabulares, las columnas de latencia bailan mientras entran las
muestras. No sustituir por la sans "porque queda más limpio".

## 4. Mayúsculas solo en `caption-uppercase`

El sistema anterior usaba Bebas Neue, que es caps-only por diseño, así que
`uppercase` en un título salía gratis. **Inter no es Bebas.** En display, las
mayúsculas se leen como grito y cuestan legibilidad.

Cursor pone mayúsculas en un solo escalón: `caption-uppercase`, 11px. Los
kickers y los encabezados de tabla van ahí. Ningún `display-*` lleva
`uppercase`, y ninguno lleva `leading-none` — los tokens ya traen su interlínea
y forzarla a 1 corta las descendentes de Inter.

## 5. Un solo tema, claro

No hay modo oscuro, ni atributo `data-theme`, ni variante `dark`, ni script
anti-flash. Se eliminaron a propósito: la referencia no define valores oscuros
y uno derivado sería inventado. `Layout.astro` declara
`<meta name="color-scheme" content="light">`.

## 6. Los componentes nombran un rol, nunca un color

`bg-surface`, `text-primary`, `border-hairline`, `rounded-card`. Los colores de
Cursor aparecen **solo** en el bloque de alias de `src/styles/global.css`.

Las clases se escriben como **strings estáticos** para que el escáner de
Tailwind las vea. Las combinaciones repetidas se factorizan en recetas
(`src/ui/button-recipes.ts`), nunca se construyen por interpolación.

## 7. Anchos

| Token | Valor | Para qué |
|---|---|---|
| `--container-dashboard` | 110rem | la consola: tabla y gráfico tienen que convivir |
| `--container-editorial` | 96rem | `/proyecto`: a 110rem una figura se agranda y un párrafo deja un tercio de tarjeta vacío |

El ancho de lectura se fija **por bloque** (`max-w-[70ch]`), no por token.
`max-w-prose` es una utilidad fija de Tailwind (65ch) que una variable de tema
**no pisa** — hubo un `--container-prose: 1200px` muerto durante meses por eso.

## 8. La trampa de los tokens muertos

**Esto no rompe la compilación.** Un token renombrado o borrado deja atrás:

1. **Strings `var(--...)` consumidos desde JS** — `render-chart.ts` pinta el SVG
   con ellos, y `colorVar` en `ui/labels.ts` también. Si el token no existe, el
   SVG se pinta con el valor por defecto y falla en silencio.
2. **Clases `fill-*` y `stroke-*` en los diagramas.** Peor todavía: una
   `fill-*` inexistente no deja el elemento sin pintar, lo deja con el negro
   por defecto de SVG. En la migración desde Caldera, `fill-pure-white` puso
   **texto negro sobre una caja negra** y el compilador no dijo nada.

Después de cualquier cambio de tokens, correr:

```bash
rg -n "var\(--" src/ --glob '*.ts' --glob '*.astro'
rg -o "(fill|stroke)-[a-z-]+" src/ | sort -u
```

y confirmar que cada nombre existe en `@theme`.

## 9. El eje de movimiento

La referencia no define un eje de tiempo: Cursor es un sitio estático y no
documenta ni una curva ni una duración. Esto es, por lo tanto, una extensión
del sistema, no una herencia — y por eso el vocabulario se mantiene deliberadamente
pequeño en vez de copiar una escala completa de otro lugar.

| Token | Valor | Para qué |
|---|---|---|
| `--ease-out-quart` | `cubic-bezier(0.25, 1, 0.5, 1)` | la única curva; todo lo que se mueve entra con ella |
| `--animate-rise` | `rise 420ms var(--ease-out-quart) both` | chrome de entrada (header, banner, barra de control, card del form) |

`@keyframes reveal` existe pero no tiene token: `.reveal-on-scroll` lo consume
directo con `animation: reveal linear both` porque una animación dirigida por
scroll avanza con la posición del scroll, no con un reloj — una duración en
milisegundos ahí sería incorrecta. Una sola curva y una sola duración con
nombre son el mínimo que separa "entra de golpe" de "entra con intención";
agregar una segunda curva compraría variedad que nadie percibe.

**Solo `opacity` y `transform`.** El compositor las anima sin recalcular
layout; cualquier otra propiedad fuerza reflow por frame, y esta página
dibuja tres SVG completos (`PortDiagram`, `RunFlowDiagram`, `PhaseDiagram`)
que no pueden permitirse repintarse en cada uno.

**El escalonado de la consola llega hasta la card y no entra al formulario.**
Header, banner, barra de control y la card del `<form>` reciben
`animate-rise` con un delay creciente; ningún fieldset, label o input
adentro se anima. Retrasar un control que el usuario ya quiere tocar es
hostilidad disfrazada de diseño, no pulido.

**La entrada por tiempo no lleva fade.** Un elemento en `opacity: 0` sigue
siendo enfocable y clickeable: animar la opacidad de un contenedor que tiene
controles adentro los deja alcanzables por teclado antes de ser visibles. El
deslizamiento solo mueve; el elemento está visible todo el tiempo. El fade
queda reservado al reveal por scroll, donde el foco al entrar scrollea la
sección a la vista y ese mismo scroll la revela.

**Nada del paso 2 se anima. Esta es la regla más importante de la sección.**
La tabla, los tres gráficos, la barra de progreso y la región de estado se
repintan cientos de veces por corrida — es la superficie que recibe cada
`sample-completed` del SSE. Esta app mide latencia; sumarle costo de
composición al hilo principal que ese mismo paso está reportando sesgaría los
números que la herramienta existe para producir.

**`prefers-reduced-motion: reduce` aplasta duración Y delay.** Aplastar solo
la duración deja el `animation-delay` intacto: con un escalonado de varios
elementos, alguien que pidió menos movimiento vería el contenido aparecer
tarde y en escalones — exactamente el efecto que reduced-motion existe para
evitar, solo que estirado en el tiempo en vez de dibujado en el espacio.

## 10. Reglas heredadas que siguen valiendo

- **Solo utilidades de Tailwind en el markup**; nada de bloques `<style>` en
  los `.astro`.
- **Iconos: `src/ui/icons.ts`**, cuerpos SVG en strings (Lucide ISC + Simple
  Icons CC0). Sin librería ni JS en runtime. El mapeo operación/motor → icono
  vive en las tablas totales de `ui/labels.ts`, así que agregar un
  `OperationId` sin icono no compila. La clase se pasa **literal** en el call
  site o Tailwind no la ve.
- **Si un nodo contiene un icono, nunca asignarle `textContent` al padre**:
  borra el SVG. Por eso el botón de ejecutar expone `[data-ref="run-label"]` y
  `[data-ref="run-icon"]`, y los encabezados de tabla envuelven el rótulo y el
  tooltip en un `span` en vez de escribir texto directo.
- **`src/ui/Checkbox.astro` es el input nativo con `appearance-none`**, no un
  `div` disfrazado: conserva teclado, `<label>`, valor de formulario y estado
  accesible. El tick se revela con `peer-checked`.
- **Los diagramas nunca bajan de su ancho legible.** `Figure.astro` les pone un
  piso de 52rem y los hace scrollear dentro de la tarjeta; a 375px un viewBox
  de 900 unidades renderiza el texto en 3.6px. La tarjeta lleva `min-w-0` o el
  piso empuja el track del grid y **scrollea la página** en vez de la tarjeta.
