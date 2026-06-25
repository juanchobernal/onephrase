# CLAUDE.md — Onephrase

Contexto para Claude Code. Esta app vive en `/Users/juanf/onephrase/`. Usuario: juanchobernal@gmail.com (español, también dueño del proyecto Fredy en `/Users/juanf/`).

## Qué es

App de traducción para **gafas Even Realities G2** que escucha por el micrófono de las gafas y muestra texto **en MAYÚSCULAS** en pantalla. Tiene **2 modos** configurables tanto desde la UI del teléfono como con un single-tap en la patilla de las gafas. **Ambos operan a nivel FRASE**: el display se escribe **una vez por ORACIÓN, apenas cierra** (en `. ! ? …`, sin esperar a que el hablante termine toda la idea — ver fix v15 abajo):

1. **`translate`** — Auto-detect → ES. Frase completa traducida, centrada (wrap-line si no cabe), reemplaza al llegar la siguiente. Default al iniciar.
2. **`transcribe`** — Auto-detect (sin traducir). Frase completa en el idioma original, centrada.

Single-tap = cicla 1→2→1. Double-tap = salir con diálogo. Modo activo persiste vía `bridge.setLocalStorage`. En reposo (al inicio y tras 20 s de silencio) se muestra un **menú de una línea `OP >Traductor  Transcripción`** con "OP" parpadeando y `>` antes del modo activo; el tap alterna el modo y refleja el cambio en el menú.

> **Por qué solo frases (no palabra-a-palabra):** los modos `*-word` originales (drip de 350 ms) **congelaban el display en hardware real**. Causa raíz confirmada (2026-06-22): el audio del mic sube por el mismo enlace **BLE** que las escrituras al display; escribir *mientras* se habla satura el BLE y cuelga las escrituras. Escribir **al pausar** (fin de utterance, cuando el audio baja) lo resuelve. Ver detalle en la sección de bug resuelto abajo.

## Stack

- **Vite + TypeScript + `@evenrealities/even_hub_sdk`** (template `asr` de [evenhub-templates](https://github.com/even-realities/evenhub-templates)).
- **STT**: Deepgram WebSocket streaming, modelo `nova-2-general`, `detect_language=true`, `interim_results=true`, `smart_format`, `utterance_end_ms=1000`, `endpointing=300`. Key via subprotocolo `['token', key]` porque el navegador no permite Authorization headers en WS.
- **Traducción**: Google Cloud Translation **v2** (REST con API key, no v3 OAuth). Cache de strings idénticos.
- **Centrado de texto**: `@evenrealities/pretext` (`getTextWidth`, `measureTextWrap`). La SDK del G2 **NO tiene fontSize ni text-align** — el texto se renderiza con la fuente fija de 27 px de line-height, alineado a la izquierda dentro de `paddingLength`. El centrado se logra rellenando con **espacios líderes y saltos de línea**.

## Arquitectura de archivos

```
onephrase/
├── app.json                 # package_id=com.example.onephrase, permisos g2-microphone + network (whitelist deepgram + googleapis)
├── .env.example             # template (committed)
├── .env.local               # llaves reales (gitignored, NO commitear)
├── index.html               # title=Onephrase
├── src/
│   ├── main.ts              # bridge init, mode state, ruteo STT→traducir→render, manejo de eventos
│   ├── modes.ts             # tipo Mode, lista MODES[], labels (HTML + glasses uppercase), nextMode(), isTranslationMode()
│   ├── glasses-render.ts    # GlassesStage (debounced textContainerUpgrade); formatAnchored (frases ancladas arriba-izq), formatCenteredWord/Sentence, formatMenu (menú de reposo 1 línea)
│   ├── ui.ts                # UI del teléfono: selector 2 modos, chip idioma fuente (`EN →`, rojo en error), desplegable idioma destino (deshab. en transcripción), boards transcripción/traducción
│   ├── langs.ts             # Lista de idiomas destino (TARGET_LANGS, códigos Google v2 + etiquetas ES), validación, default 'es'
│   └── asr/
│       ├── stt.ts           # Cliente Deepgram WS, emite onLatestWord (mirror en teléfono) + onUtterance (dispara ambos modos)
│       └── translate.ts     # Google Translate v2 con cache in-memory
```

## Comandos comunes

```bash
# Dev server (mantén corriendo)
cd /Users/juanf/onephrase && npm run dev   # http://localhost:5173

# Simulador desktop
cd /Users/juanf/onephrase && npm run simulate

# Simulador con automation API en puerto 9898 (para screenshots + inputs por curl)
node node_modules/@evenrealities/evenhub-simulator/bin/index.js http://localhost:5173 --automation-port 9898 &
# luego: curl -s http://127.0.0.1:9898/api/screenshot/glasses -o /tmp/glasses.png
#        curl -s -X POST -H "Content-Type: application/json" -d '{"action":"click"}' http://127.0.0.1:9898/api/input
#        curl -s http://127.0.0.1:9898/api/console

# QR para sideload a gafas reales (Mac y teléfono en la misma WiFi)
npx evenhub qr --url http://$(ipconfig getifaddr en0):5173

# Empaquetar para distribución privada (.ehpk)
npm run build
npx evenhub pack   # genera el .ehpk, se carga desde la app Even Hub como app local privada
```

## Constantes clave (ajustar aquí)

| Constante | Archivo | Default | Qué controla |
|---|---|---|---|
| `PHRASE_BASE_MS` | `src/main.ts` | `750` | Tiempo base por frase (cola con catch-up) |
| `PHRASE_PER_WORD_MS` | `src/main.ts` | `290` | ms añadidos por palabra (calibrado con la tabla de lectura del usuario) |
| `PHRASE_MIN_MS` / `PHRASE_MAX_MS` | `src/main.ts` | `1400` / `4500` | Piso/techo del tiempo por frase |
| `CATCHUP_THRESHOLD` | `src/main.ts` | `2` | Nº de frases en cola toleradas a tiempo de lectura COMPLETO antes de comprimir. Clave: los 2-3 trozos en que se parte una oración NO deben disparar catch-up. |
| `CATCHUP_FACTOR` / `PHRASE_CATCHUP_FLOOR_MS` | `src/main.ts` | `0.6` / `2000` | Ante atraso real (`>CATCHUP_THRESHOLD` en cola) el dwell = `max(floor, dwell×factor)`. **NO se descartan frases** (no-skip); se comprime pero nunca por debajo del piso legible. |
| `IDLE_CLEAR_MS` | `src/main.ts` | `15000` | Silencio tras el cual la pantalla vuelve al menú de reposo (`enterMenu`) |
| `BLINK_MS` | `src/main.ts` | `800` | Periodo de parpadeo del "OP" en el menú de reposo |
| `FLUSH_MAX_WORDS` | `src/asr/stt.ts` | `24` | Red de seguridad: corta el fragmento sin puntuación terminal al llegar a N palabras (evita blob). Desde v15 las frases se vacían por **oración** (`flushCompleteSentences`), así que este tope solo aplica a monólogos sin `. ! ?`. |
| `currentTargetLang` / `DEFAULT_TARGET_LANG` | `src/main.ts` / `src/langs.ts` | `'es'` | Idioma destino. Ya **no es hardcoded**: se elige en el desplegable del teléfono (v18), persiste en `onephrase:targetLang`. Lista de idiomas en `src/langs.ts` (`TARGET_LANGS`, incl. árabe `ar`). |
| `BUILD` | `src/main.ts` | `'v19'` | Etiqueta de versión en el header. **Subir con cada cambio + sincronizar con el `?v=N` del QR** para verificar que cargó el bundle nuevo. |
| `endpointing` (en `DEEPGRAM_URL`) | `src/asr/stt.ts` | `300` | ms de silencio para cerrar frase en **oración natural**. Subió de 150 (ya no fragmentamos para evitar skips — eso lo resuelve la acumulación + no-drop). **Modelo real = `nova-3` + `language=multi`**. |
| `DEBOUNCE_MS` | `src/glasses-render.ts` | `120` | Debounce para `textContainerUpgrade` (la cola BLE es lenta — bajarlo causa lag). |

## Gotchas no obvias

1. **Variables `VITE_*` quedan en el bundle JS**: la app es client-side, no hay backend. Cualquiera con DevTools puede leer las API keys. OK para sideload privado en tus propias gafas; **NO publicar a la tienda con keys en el bundle**.

2. **Protobuf omite valores cero**: `CLICK_EVENT = 0` llega como `sysEvent: { eventSource: 1 }` SIN `eventType`. Por eso `main.ts` usa `envelopeEventType(env)` que devuelve `null` si no hay envelope y `env.eventType ?? 0` si lo hay. **Importante**: no usar `?? null` directo en `event.sysEvent?.eventType` — eso convierte CLICK en null y rompe el detector de tap.

3. **Centrado en pantalla**: la fuente es fija 27 px, sin alineación. `formatCenteredWord` mide la palabra con `getTextWidth`, calcula cuántos espacios líderes faltan, y prepende N saltos de línea para centrar verticalmente. `formatCenteredSentence` hace lo mismo línea-por-línea con `greedyWrap`.

4. **Cancelar traducciones obsoletas**: cuando llega una nueva utterance mientras hay una traducción en vuelo, `pendingUtteranceId` se incrementa. Si la traducción anterior resuelve después, su `myId !== pendingUtteranceId` y se descarta (no clobber).

5. **Switch de modo limpia drip queue**: cambiar modo en mitad de un drip de palabras (modo 1) drena la cola, cancela el timer, e invalida traducciones en vuelo. Esto evita ver palabras del modo anterior aparecer en el nuevo.

6. **⚠️ `bridge.getLocalStorage` de una llave NUNCA guardada SE CUELGA en el dispositivo real (no en el simulador del Mac).** Confirmado v18→v19 (2026-06-25): añadir `await bridge.getLocalStorage('onephrase:targetLang')` (llave nueva, nunca seteada) **congeló todo el arranque** en las gafas — sin mic, sin STT, no transcribía ni traducía — pero en el simulador del Mac funcionaba (ahí devuelve `null` al instante). Un `try/catch` NO basta: el promise no rechaza, **nunca se settlea**. Fix: `loadStored(key)` corre `getLocalStorage` contra un `Promise.race` con timeout de 1.5s → si se cuelga, sigue con el default. **Regla: toda lectura de `getLocalStorage` al arranque debe ir con timeout.** Síntoma diagnóstico clave: "funciona en el Mac, falla en el dispositivo" + arranque que no llega al mic.

## Decisión de despliegue (2026-06-18)

**Objetivo confirmado**: empaquetar la app como **`.ehpk` privado** y cargarla desde la app **Even Hub** como app local (no a la tienda pública). No se hostea en servidor — la app vive offline en el `.ehpk`, las únicas llamadas de red son a Deepgram (STT WebSocket) y Google Translate v2 (REST).

**Por qué `.ehpk` y no sideload con dev server**: no requiere que el Mac esté prendido ni en la misma WiFi cada vez. Una vez cargado a Even Hub, la app está disponible permanentemente desde el menú del teléfono.

**Por qué Deepgram + Google Translate y no la app oficial Translate de Even Realities**: Even Realities no expone STT on-device en el SDK (confirmado en GitHub topic `g2-glasses` y en su soporte — la app oficial Translate corre en su nube cerrada, sin API pública). Para construir nuestra propia traducción tenemos que cablear servicios nube nosotros. Deepgram da streaming sub-segundo de palabras (clave para el modo 2 transcribe-word en tiempo real) y Google Translate v2 sirve con la misma `GOOGLE_API_KEY` que ya tienes en GCP (project `92102193775`).

## Estado pendiente / TODO al retomar

### 🔧 EN CURSO (2026-06-23, sesión 5) — calidad de traducción + anclaje + menú

**Hecho esta sesión (build v14, validado en simulador; pendiente prueba final en gafas):**
- **Deepgram (root-cause del skipping):** se **acumulan los segmentos `is_final`** y se vacía el buffer en `speech_final` **o** en el evento **`UtteranceEnd`** (antes se ignoraba y se perdían segmentos de frases largas — anti-patrón confirmado en la doc de Deepgram). `endpointing` 150→**300** (cierra en oración natural). `FLUSH_MAX_WORDS=24` como red de seguridad anti-blob. Archivo `src/asr/stt.ts` con `flushUtterance()`.
- **No-skip / anti-lag:** se **eliminó el descarte de cola** (`PHRASE_MAX_QUEUE`). Ya **no se salta ninguna frase**; cuando va atrás se acorta el dwell (`PHRASE_CATCHUP_MS=800`) para alcanzar — como la app oficial pero sin saltos.
- **Anclaje de texto (clave):** las frases se renderizan **ancladas arriba-izquierda fijo** (`formatAnchored`/`setAnchoredSentence`), no centradas. El ojo ya no se pierde al llegar una frase nueva — **supera el único defecto de la app oficial de Even Realities** (que mueve las frases). Decisión del usuario: arriba-izq fijo.
- **Mayúsculas+minúsculas:** las frases salen en caja natural (no TODO MAYÚS).
- **Menú de reposo:** reposo (inicio + tras 20 s de silencio) = menú de una línea **`OP >Traductor  Transcripción`** con "OP" parpadeando (`BLINK_MS`, `formatMenu`), `>` antes del activo; el tap alterna. Reemplazó el banner transitorio y el clear-a-blanco. **Fix:** `clear()` escribía `''` que el G2 ignora (no borraba); ahora escribe un espacio. `MODE_MENU_LABELS` en `modes.ts`.

**Acceso al traductor de Even Realities — DESCARTADO (verificado 2026-06-23):** el SDK solo expone **PCM crudo del mic (16 kHz mono)**; su traducción/STT vive en su **nube cerrada, sin API pública**. No se puede invocar desde una app de terceros. Su app es más precisa por **pipeline integrado STT+traducción co-afinado + 4 mics direccionales con filtrado de ruido**; nosotros pegamos Deepgram + Google Translate v2 genéricos. Estrategia: igualar su comportamiento (sin saltos/descartes) y **ganarles en el anclaje** (ya hecho). Fuente: zenn.dev/bigdra (SDK feature verification).

**Hecho sesión 6 (build v15, validado en gafas reales 2026-06-25):**
- ✅ **Primera frase lenta — RESUELTO.** Causa: el buffer solo se vaciaba en `speech_final` (fin de toda la idea). Fix en `src/asr/stt.ts`: en cada `is_final` se vacían **las oraciones que ya cerraron** (`flushCompleteSentences` + `splitSentences`), partiendo en `. ! ? …` solo cuando la puntuación va al final o seguida de espacio (no parte decimales tipo `2.5`). La primera oración pinta apenas Deepgram la finaliza, sin esperar la pausa final. El fragmento incompleto sobrante se vacía en `speech_final`/`UtteranceEnd`/tope 24 palabras como antes. `onUtterance` ahora dispara **por oración**, no por utterance. Bonus: ataca de paso el #2 (párrafos largos → se parten en oraciones). BLE: ~1 escritura por oración (antes 1 por utterance), siempre en gaps — validado sin freeze.
  - Limitación cosmética conocida: abreviaturas con punto+espacio (`Sr. García`) se parten en `"Sr."` + resto. Raro; `smart_format` suele evitarlo. Afinar con diccionario de abreviaturas solo si molesta en uso real.

- ✅ **Párrafos de 3-4 líneas — RESUELTO (build v16/v17, validado en gafas 2026-06-25).** El split por oración no bastaba: una oración larga de una sola idea (sin punto interno) salía entera = 3-4 líneas. Fix `chunkForReading()` en `src/glasses-render.ts`: parte cualquier frase a mostrar en **trozos de ≤2 líneas** (medido con `measureTextWrap` contra `ANCHOR_USABLE_W=566px`), cortando en cláusula (`, ; :` o antes de conjunción del set `CLAUSE_CONJUNCTIONS`), con corte duro por palabras como último recurso. Corre sobre el **texto final ya traducido** (`enqueuePhrase` en `main.ts`), porque la traducción cambia el largo. No parte decimales.
- ✅ **Saltos rápidos entre trozos/frases — RESUELTO (build v17).** El chunking metía backlog artificial: al mostrar el trozo 1 ya había trozo 2 en cola → el catch-up lo trataba como "atrasado" y lo apuraba (no se alcanzaba a leer). Fix en `drainPhraseQueue`: el catch-up **solo** comprime ante atraso REAL (`phraseQueue.length > CATCHUP_THRESHOLD=2`); el flujo normal (incl. los 2-3 trozos de una oración) recibe **tiempo de lectura completo** (`dwellMs`). Comprimir nunca baja de `PHRASE_CATCHUP_FLOOR_MS=2000` (`max(floor, dwell×CATCHUP_FACTOR=0.6)`). `PHRASE_MIN_MS` 1100→1400 para fragmentos cortos.

**Traducción "en vivo" / latencia en gafas — DECIDIDO dejar como está (2026-06-25):** el usuario notó que en las gafas las frases traducidas "tardan en aparecer". Es **inherente y casi óptimo**: hay que esperar (1) el fin de oración + micro-pausa, y (2) el round-trip a Google Translate. El único botón es bajar `endpointing` (300), pero eso reintroduce el corte a media idea que ya arreglamos → no vale la pena. **No mostrar traducción incremental "en vivo" en las gafas: es justo el bug de freeze BLE** (escribir texto que cambia mientras sube el audio congela el display). La traducción incremental SOLO sería viable en el **board del teléfono** (sin límite BLE), pero **al usuario solo le importan las gafas**, así que esa mejora del teléfono queda **descartada** (no re-proponerla). Conclusión: el comportamiento actual (frase completa al pausar) es el techo de fluidez del hardware.

**Problemas abiertos (próxima sesión):**
1. **Calibración fina del dwell con uso prolongado** contra la tabla de abajo (`PHRASE_*`, `CATCHUP_THRESHOLD`, `CATCHUP_FACTOR`, `PHRASE_CATCHUP_FLOOR_MS`). Base validada en gafas; afinar solo si el atraso acumulado molesta con monólogos largos.

**Tabla de tiempos de lectura objetivo (referencia del usuario, 2026-06-22):**

| Frase | palabras | tiempo objetivo |
|---|---|---|
| ¿Cuál es el beneficio de estos medicamentos? | 7 | 0:03 |
| El estudio lo demuestra. | 4 | 0:02 |
| Hay un estudio que abarca quince años. Hay otro | 9 | 0:03 |
| que abarca treinta años | 4 | 0:02 |
| La quimioterapia alarga la vida entre dos y tres meses | 10 | 0:04 |
| Dos o tres meses | 4 | 0:02 |
| Es la suma del beneficio | 5 | 0:02 |
| Para algunos tipos de cáncer, como el cáncer gástrico. | 9 | 0:03 |
| Reducen la esperanza de vida. | 5 | 0:04 |

→ Aprox **2s** para 4-5 palabras, **3s** para 7-9, **4s** para 10. ≈ 0.35-0.4s/palabra + base.

**Recordatorio de prueba (gotcha del HMR):** cada cambio → subir `BUILD` en `main.ts` Y el `?v=N` del QR al mismo número; **confirmar en el header de la app que dice ese `vN`** — si no, estás viendo un bundle viejo cacheado (es lo que pasó esta sesión: "no lo hace bien" = código viejo).

### ✅ BUG RESUELTO (2026-06-22) — freeze del display por contención BLE audio↔display

**Síntoma original:** en gafas físicas (no en el simulador) el display se **congelaba** mostrando solo la primera palabra/frase, aunque se siguieran escuchando frases.

**Causa raíz confirmada (bisección en hardware con instrumentación):** el audio del mic **sube por el mismo enlace BLE** que las escrituras al display (`textContainerUpgrade`). Escribir el display **mientras se habla** satura el BLE y **cuelga las escrituras**. Evidencia:
- Heartbeat escribiendo cada 300ms **en silencio** → fluye perfecto (el BLE aguanta el ritmo si no hay audio subiendo).
- Con habla real → gafas congeladas en el primer write, pero el tracer en la UI del teléfono (DOM, sin BLE) seguía avanzando ⇒ el pipeline vive; muere la escritura BLE, y solo con `audioControl(true)` activo.
- Confirmado por contraste de modos: el modo **frase** (1 write tras la pausa, cuando el audio baja) **fluye**; el modo **palabra-a-palabra** (drip de 350 ms, escribe durante el habla) **se congela**.
- Apoyo externo: el BLE de las G2 es de banda muy baja (≈4 FPS para imagen 50×50px, [zenn.dev/bigdra](https://zenn.dev/bigdra/articles/eveng2-sdk-features?locale=en)).

**Fix aplicado:** rediseño a **2 modos, ambos a nivel frase** — se escribe el display **una sola vez por utterance, al final** (cuando el hablante pausa). Eliminados los modos `*-word` y todo el word-drip (`enqueueWordDrip`/`drainDripQueue`/`WORD_DRIP_MS`). El `Promise.race([textContainerUpgrade, timeout(2000ms)])` en `glasses-render.ts` se mantiene como red de seguridad (libera `inflight` si un write se cuelga). Instrumentación de diagnóstico (`DIAG_TRACE`, contadores `gw`) **ya removida**. **Validado en hardware: los 2 modos fluyen sin congelarse.**

**Roadmap restante:** (1) más ajustes de UI del teléfono; (2) camino al `.ehpk` privado (ver más abajo). Rename `oneword`→`onephrase`: ✅ hecho 2026-06-22 (carpeta, package.json, app.json `name`+`package_id`, index/h1, `MODE_STORAGE_KEY=onephrase:mode`, repo GitHub).

**⚠️ GOTCHA CONFIRMADO (2026-06-22) — el HMR NO llega al WebView del teléfono:** guardar el archivo recarga el **simulador** pero **NO las gafas/teléfono**. Tras **cada** cambio de código hay que **re-escanear el QR** para cargar el bundle nuevo (un freeze "que no se arregla con el fix" suele ser código viejo cacheado). Esto contradice la nota previa de "hot-reload en gafas" — no es confiable.

**Cómo retomar (dev server quizá detenido):** (1) `cd /Users/juanf/onephrase && npm run dev`; (2) `npx evenhub qr --url http://$(ipconfig getifaddr en0):5173` **desde la carpeta del proyecto**; (3) Even Hub tab → Scan QR (Developer Mode ya activo); (4) **re-escanear el QR tras cada edición** (el HMR no basta).

### ⚙️ GOTCHA — activar Developer Mode para sideload (resuelto 2026-06-19, no obvio)

El "Developer Center" / "Scan QR" **NO aparece en la app iOS** hasta activar Developer Mode, y eso **no es un toggle ni un gesto en las gafas**: (1) login en `hub.evenrealities.com/login` con la **misma cuenta** de la app (`juanchobernal@gmail.com`), (2) **force-quit de la app** (deslizarla del app-switcher, no solo background) y reabrir, (3) aparece la sección de desarrollador **arriba-derecha en la pestaña "Even Hub"** → "Scan QR". Sin el force-quit no aparece aunque ya seas dev registrado. Local testing = Even Hub tab → Scan QR (apuntar a la terminal con el QR).

**Camino al `.ehpk` privado** (siguiente fase tras resolver el bug de render):

1. [x] **Probar end-to-end en dev — HECHO (2026-06-19).** `npm run dev` + simulador con `--automation-port 9898`, hablándole al mic del Mac, los 3 modos validados con screenshots de las gafas: modo 1 translate-word ("RÁPIDO."), modo 2 transcribe-word ("TODAY?", idioma original sin traducir), modo 3 translate-sentence ("VINCULADO A LAS GRANDES FARMACÉUTICAS"). Deepgram + Google Translate OK, 0 errores. Verificado vía log `[diag]` temporal que `onLatestWord` llega en modo 2 (el "blank" inicial fue timing del screenshot, no bug). `WORD_DRIP_MS=350` se sintió bien, no se ajustó.
2. [x] **Sideload en gafas reales — FUNCIONA (2026-06-19), con bug de render abierto (ver abajo).** `cd /Users/juanf/onephrase && npx evenhub qr --url http://<IP-LAN>:5173` (IP del Mac en WiFi, p.ej. `192.168.86.247`; **correr DESDE la carpeta del proyecto** o `evenhub` da 404 npm). Onephrase carga y corre en las gafas físicas con hot-reload. Confirmado: las llamadas Deepgram + Google funcionan desde el teléfono.
3. [x] **Verificar `app.json` antes de empaquetar — HECHO, está OK**: `min_sdk_version=0.0.10`, `name` ≤20 chars, permisos `g2-microphone` + `network` con whitelist `api.deepgram.com` + `translation.googleapis.com`. (`package_id=com.example.onephrase` usa namespace placeholder; irrelevante para privado.)
4. [x] `npm run build` → `tsc --noEmit && vite build` produce `dist/`. **HECHO (2026-06-25, build v17):** 204 KB JS / 64 KB gzip, type-check limpio.
5. [x] **Empaquetar — HECHO (2026-06-25):** `npx evenhub pack app.json dist -o onephrase-0.1.0.ehpk` → `onephrase-0.1.0.ehpk` (68 KB). El `.ehpk` y `dist/` están **gitignored** (no se commitean) — correcto, porque las llaves `.env.local` quedan **bakeadas en el bundle** (Gotcha #1; aceptable por ser privado).
6. [x] **Cargar el `.ehpk` (flujo "Private testing") — HECHO (2026-06-25): corre bien instalada desde el paquete.** Subir el `.ehpk` en `hub.evenrealities.com/login` → proyecto → pestaña **Private builds**. Luego en la app: **Me → Apps → Private builds → Install** (requiere Developer Mode activo, ver gotcha). NO tiene hot-reload (~10s por ciclo). **Para re-empacar tras cambios: subir `BUILD`, `npm run build`, `npx evenhub pack app.json dist -o onephrase-<ver>.ehpk`, reinstalar.**

**Mejoras razonables una vez funcionando:**

- [ ] Probar latencia real del modo 1 (translate-word): acumula Deepgram utterance (~1 s endpointing) + Google translate (~200-400 ms) + drip (350 ms × N palabras). Si se siente lento, considerar bajar `WORD_DRIP_MS` a 250 ms o iniciar drip cuando llegue la primera mitad de la frase.
- [ ] Pensar si quieres que el `--asr` config de `app.json` también pida permiso `phone-microphone` como fallback en caso de que el mic de las gafas falle.
- [x] **Selector de idioma destino en el teléfono — HECHO (v18/v19, 2026-06-25).** Desplegable en la cabecera (10 idiomas incl. árabe), persiste en `onephrase:targetLang`, etiqueta del board dinámica, deshabilitado en transcripción, limpia cola al cambiar. ⚠️ **Árabe (`ar`) es RTL y el render de gafas es LTR — sin verificar a fondo en hardware;** puede salir con alineación/orden raros o sin glifos. Si molesta, restringirlo al board del teléfono o quitarlo.
- [ ] Si Deepgram queda costoso con uso real (créditos gratis se agotan), evaluar OpenAI Whisper streaming o un STT self-hosted en el Pi de Fredy como backend.

## Tests manuales pasados en la sesión inicial (2026-06-18)

- ✅ `tsc --noEmit` pasa sin errores.
- ✅ Simulador renderiza los 3 banners de modo centrados verticalmente, en mayúsculas, en la pantalla 576×288 (screenshots en `/tmp/glasses{3,4,5}.png` durante la sesión).
- ✅ Single-tap cicla modos correctamente (después del fix de `envelopeEventType` para CLICK_EVENT).
- ✅ UI del teléfono muestra selector de modos con el activo destacado en verde, chip rojo si falta API key, dos boards de mirror (transcripción/traducción).
- ✅ **STT + traducción reales validados end-to-end (2026-06-19)** — los 3 modos funcionan hablándole al mic del Mac vía simulador. Ver detalle en el paso 1 del camino al `.ehpk` arriba.

## Referencias

- SDK reference: skill `everything-evenhub:sdk-reference`
- Font measurement: skill `everything-evenhub:font-measurement`
- Simulator API: skill `everything-evenhub:simulator-automation`
- Build/pack: skill `everything-evenhub:build-and-deploy`
- Templates upstream: https://github.com/even-realities/evenhub-templates
