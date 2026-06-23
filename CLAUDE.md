# CLAUDE.md — Onephrase

Contexto para Claude Code. Esta app vive en `/Users/juanf/onephrase/`. Usuario: juanchobernal@gmail.com (español, también dueño del proyecto Fredy en `/Users/juanf/`).

## Qué es

App de traducción para **gafas Even Realities G2** que escucha por el micrófono de las gafas y muestra texto **en MAYÚSCULAS** en pantalla. Tiene **2 modos** configurables tanto desde la UI del teléfono como con un single-tap en la patilla de las gafas. **Ambos operan a nivel FRASE**: el display se escribe **una vez por utterance, después de que el hablante pausa**:

1. **`translate`** — Auto-detect → ES. Frase completa traducida, centrada (wrap-line si no cabe), reemplaza al llegar la siguiente. Default al iniciar.
2. **`transcribe`** — Auto-detect (sin traducir). Frase completa en el idioma original, centrada.

Single-tap = cicla 1→2→1 (muestra el nombre del modo en pantalla 900 ms). Double-tap = salir con diálogo. Modo activo persiste vía `bridge.setLocalStorage`.

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
│   ├── glasses-render.ts    # GlassesStage (debounced textContainerUpgrade), formatCenteredWord/Sentence, espaciado + newlines para centrar
│   ├── ui.ts                # UI del teléfono: selector 2 modos, chip idioma (auto→lang, rojo en error), boards transcripción/traducción
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
| `PHRASE_BASE_MS` | `src/main.ts` | `600` | Tiempo base que cada frase está en pantalla (cola adaptativa) |
| `PHRASE_PER_WORD_MS` | `src/main.ts` | `320` | ms añadidos por palabra (tiempo de lectura proporcional) |
| `PHRASE_MIN_MS` / `PHRASE_MAX_MS` | `src/main.ts` | `900` / `5500` | Piso/techo del tiempo por frase |
| `MODE_BANNER_MS` | `src/main.ts` | `900` | Cuánto dura el nombre del modo en pantalla tras cambiar. |
| `TARGET_LANG` | `src/main.ts` | `'es'` | Idioma destino para traducción. |
| `BUILD` | `src/main.ts` | `'v8'` | Etiqueta de versión mostrada en el header de la app. **Subir con cada cambio + sincronizar con el `?v=N` del QR** para verificar que cargó el bundle nuevo. |
| `endpointing` (en `DEEPGRAM_URL`) | `src/asr/stt.ts` | `150` | ms de silencio para cerrar una frase. Bajo = menos skips pero fragmenta más. **Modelo real = `nova-3` + `language=multi`** (la SDK ref/notas viejas decían nova-2, está desactualizado). |
| `DEBOUNCE_MS` | `src/glasses-render.ts` | `120` | Debounce para `textContainerUpgrade` (la cola BLE es lenta — bajarlo causa lag). |

## Gotchas no obvias

1. **Variables `VITE_*` quedan en el bundle JS**: la app es client-side, no hay backend. Cualquiera con DevTools puede leer las API keys. OK para sideload privado en tus propias gafas; **NO publicar a la tienda con keys en el bundle**.

2. **Protobuf omite valores cero**: `CLICK_EVENT = 0` llega como `sysEvent: { eventSource: 1 }` SIN `eventType`. Por eso `main.ts` usa `envelopeEventType(env)` que devuelve `null` si no hay envelope y `env.eventType ?? 0` si lo hay. **Importante**: no usar `?? null` directo en `event.sysEvent?.eventType` — eso convierte CLICK en null y rompe el detector de tap.

3. **Centrado en pantalla**: la fuente es fija 27 px, sin alineación. `formatCenteredWord` mide la palabra con `getTextWidth`, calcula cuántos espacios líderes faltan, y prepende N saltos de línea para centrar verticalmente. `formatCenteredSentence` hace lo mismo línea-por-línea con `greedyWrap`.

4. **Cancelar traducciones obsoletas**: cuando llega una nueva utterance mientras hay una traducción en vuelo, `pendingUtteranceId` se incrementa. Si la traducción anterior resuelve después, su `myId !== pendingUtteranceId` y se descarta (no clobber).

5. **Switch de modo limpia drip queue**: cambiar modo en mitad de un drip de palabras (modo 1) drena la cola, cancela el timer, e invalida traducciones en vuelo. Esto evita ver palabras del modo anterior aparecer en el nuevo.

## Decisión de despliegue (2026-06-18)

**Objetivo confirmado**: empaquetar la app como **`.ehpk` privado** y cargarla desde la app **Even Hub** como app local (no a la tienda pública). No se hostea en servidor — la app vive offline en el `.ehpk`, las únicas llamadas de red son a Deepgram (STT WebSocket) y Google Translate v2 (REST).

**Por qué `.ehpk` y no sideload con dev server**: no requiere que el Mac esté prendido ni en la misma WiFi cada vez. Una vez cargado a Even Hub, la app está disponible permanentemente desde el menú del teléfono.

**Por qué Deepgram + Google Translate y no la app oficial Translate de Even Realities**: Even Realities no expone STT on-device en el SDK (confirmado en GitHub topic `g2-glasses` y en su soporte — la app oficial Translate corre en su nube cerrada, sin API pública). Para construir nuestra propia traducción tenemos que cablear servicios nube nosotros. Deepgram da streaming sub-segundo de palabras (clave para el modo 2 transcribe-word en tiempo real) y Google Translate v2 sirve con la misma `GOOGLE_API_KEY` que ya tienes en GCP (project `92102193775`).

## Estado pendiente / TODO al retomar

### 🔧 EN CURSO (2026-06-22, sesión 4) — pulir el display de frases

**Hecho esta sesión:** rename `oneword`→`onephrase` (carpeta + repo GitHub `juanchobernal/onephrase`); UI del teléfono (chip único `auto → idioma`, labels de modo en minúscula, banner de modo en las gafas en minúscula vía `formatCenteredSentence(.., upper=false)`, **etiqueta de build `vN` en el header**); arreglo del **skipping** = **cola de frases con tiempo de lectura adaptativo** (`PHRASE_*` en `main.ts`: `dwellMs()` + `enqueuePhrase`/`drainPhraseQueue`, se quitó `pendingUtteranceId`, se serializa la traducción con `translateChain` para preservar orden) + `endpointing` 300→150 en Deepgram. **Resultado: ya NO se salta frases**, pero quedan problemas.

**Problemas abiertos (resolver la próxima sesión):**
1. **Desfases (lag):** con habla continua la cola se acumula y el display se atrasa respecto al hablante (el atraso = suma de los tiempos de cada frase en cola). Decidir cómo recortar el atraso **sin** volver a saltar frases (¿cap de cola? ¿acortar dwell cuando la cola está larga? ¿saltar a la última si va muy atrás?).
2. **Congelamientos (volvieron):** la cola escribe **durante** el habla (a veces ~900ms entre frases cortas), acercándose al umbral BLE que congelaba el word-drip. Revisar: subir espaciado mínimo, o escribir solo en ventanas de silencio.
3. **Auto-limpiar pantalla:** sacar la última frase del display tras **20 s de silencio** (timer que se resetea con cada utterance; al expirar → `glasses.clear()`).
4. **Calibrar el tiempo de lectura** con la tabla del usuario (abajo). La fórmula actual `600 + 320×palabras` (clamp 900–5500) ya queda cerca; afinar con datos reales.
5. **Aprovechar mejor Deepgram (deepgram.com):** explorar features para mejor segmentación/latencia — `utterance_end`, `interim_results` para arrancar antes, `smart_format`/puntuación, modelos, etc.

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
3. [ ] **Verificar `app.json` antes de empaquetar — HECHO, está OK**: `min_sdk_version=0.0.10`, `name` ≤20 chars, permisos `g2-microphone` + `network` con whitelist `api.deepgram.com` + `translation.googleapis.com`. (`package_id=com.example.onephrase` usa namespace placeholder; irrelevante para privado.)
4. [ ] `npm run build` → `tsc --noEmit && vite build` produce `dist/`. (Type-check ya pasa limpio.)
5. [ ] **Empaquetar — sintaxis correcta** (la doc del CLI difiere del comando viejo): `npx evenhub pack app.json dist -o onephrase-0.1.0.ehpk`. Las llaves `.env.local` quedan **bakeadas en el bundle** — ver Gotcha #1; aceptable porque la app es privada.
6. [ ] **Cargar el `.ehpk` (flujo "Private testing")**: subir el `.ehpk` en `hub.evenrealities.com/login` → proyecto → pestaña **Private builds**. Luego en la app: **Me → Apps → Private builds → Install** (requiere Developer Mode activo, ver gotcha). NO tiene hot-reload (~10s por ciclo).

**Mejoras razonables una vez funcionando:**

- [ ] Probar latencia real del modo 1 (translate-word): acumula Deepgram utterance (~1 s endpointing) + Google translate (~200-400 ms) + drip (350 ms × N palabras). Si se siente lento, considerar bajar `WORD_DRIP_MS` a 250 ms o iniciar drip cuando llegue la primera mitad de la frase.
- [ ] Pensar si quieres que el `--asr` config de `app.json` también pida permiso `phone-microphone` como fallback en caso de que el mic de las gafas falle.
- [ ] Añadir selector de idioma destino en el teléfono (hoy `TARGET_LANG='es'` hardcoded en `main.ts`).
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
