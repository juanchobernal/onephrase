# CLAUDE.md — Oneword

Contexto para Claude Code. Esta app vive en `/Users/juanf/oneword/`. Usuario: juanchobernal@gmail.com (español, también dueño del proyecto Fredy en `/Users/juanf/`).

## Qué es

App de traducción para **gafas Even Realities G2** que escucha por el micrófono de las gafas y muestra texto **en MAYÚSCULAS** en pantalla. Tiene 3 modos configurables tanto desde la UI del teléfono como con un single-tap en la patilla de las gafas:

1. **`translate-word`** — Auto-detect → ES. Drip de palabra-a-palabra (350 ms/palabra), centrada y grande. Default al iniciar.
2. **`transcribe-word`** — Auto-detect (sin traducir). Palabra-a-palabra al ritmo natural del habla, centrada y grande.
3. **`translate-sentence`** — Auto-detect → ES. Frase completa centrada (wrap-line si no cabe), reemplaza al llegar la siguiente.

Single-tap = cicla 1→2→3→1 (muestra el nombre del modo en pantalla 900 ms). Double-tap = salir con diálogo. Modo activo persiste vía `bridge.setLocalStorage`.

## Stack

- **Vite + TypeScript + `@evenrealities/even_hub_sdk`** (template `asr` de [evenhub-templates](https://github.com/even-realities/evenhub-templates)).
- **STT**: Deepgram WebSocket streaming, modelo `nova-2-general`, `detect_language=true`, `interim_results=true`, `smart_format`, `utterance_end_ms=1000`, `endpointing=300`. Key via subprotocolo `['token', key]` porque el navegador no permite Authorization headers en WS.
- **Traducción**: Google Cloud Translation **v2** (REST con API key, no v3 OAuth). Cache de strings idénticos.
- **Centrado de texto**: `@evenrealities/pretext` (`getTextWidth`, `measureTextWrap`). La SDK del G2 **NO tiene fontSize ni text-align** — el texto se renderiza con la fuente fija de 27 px de line-height, alineado a la izquierda dentro de `paddingLength`. El centrado se logra rellenando con **espacios líderes y saltos de línea**.

## Arquitectura de archivos

```
oneword/
├── app.json                 # package_id=com.example.oneword, permisos g2-microphone + network (whitelist deepgram + googleapis)
├── .env.example             # template (committed)
├── .env.local               # llaves reales (gitignored, NO commitear)
├── index.html               # title=Oneword
├── src/
│   ├── main.ts              # bridge init, mode state, ruteo STT→traducir→render, manejo de eventos
│   ├── modes.ts             # tipo Mode, lista MODES[], labels (HTML + glasses uppercase), nextMode(), isTranslationMode()
│   ├── glasses-render.ts    # GlassesStage (debounced textContainerUpgrade), formatCenteredWord/Sentence, espaciado + newlines para centrar
│   ├── ui.ts                # UI del teléfono: selector 3 modos, chip idioma, chip status, boards transcripción/traducción
│   └── asr/
│       ├── stt.ts           # Cliente Deepgram WS, emite onLatestWord (modo 2) + onUtterance (modos 1, 3)
│       └── translate.ts     # Google Translate v2 con cache in-memory
```

## Comandos comunes

```bash
# Dev server (mantén corriendo)
cd /Users/juanf/oneword && npm run dev   # http://localhost:5173

# Simulador desktop
cd /Users/juanf/oneword && npm run simulate

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
| `WORD_DRIP_MS` | `src/main.ts` | `350` | Tiempo entre palabras en modo 1 (translate-word). Reducir para más rápido. |
| `MODE_BANNER_MS` | `src/main.ts` | `900` | Cuánto dura el nombre del modo en pantalla tras cambiar. |
| `TARGET_LANG` | `src/main.ts` | `'es'` | Idioma destino para traducción. |
| `DEBOUNCE_MS` | `src/glasses-render.ts` | `120` | Debounce para `textContainerUpgrade` (la cola BLE es lenta — bajarlo causa lag). |
| Deepgram URL params | `src/asr/stt.ts` | ver `DEEPGRAM_URL` | Modelo, idioma, endpointing. `model=nova-2-general` es multilingüe. |

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

### 🔴 BUG ABIERTO — render en gafas reales (modos 1 y 2) — PRÓXIMO A RESOLVER (2026-06-19)

**Síntoma:** en las **gafas físicas** (no en el simulador), **los TRES modos** muestran **solo UNA palabra** y se **congelan** — esa palabra **no cambia nunca** aunque se sigan escuchando frases. Confirmado con el usuario que el **modo 3 (translate-sentence) también se congela** igual. El **simulador del Mac muestra los 3 modos perfecto** — son instancias independientes (simulador = render instantáneo; gafas = escritura por **Bluetooth LE**, lento).

**Diagnóstico ACTUALIZADO (2026-06-22) — NO es el deadlock de `inflight`; es congestión BLE audio↔display al hablar:** el fix del `Promise.race([textContainerUpgrade, timeout(2000ms)])` **ya está aplicado** en `glasses-render.ts` y es correcto (libera `inflight`), pero **el freeze persiste**. Bisección hecha en hardware real con instrumentación:
- **Heartbeat** escribiendo cada 1000ms y luego cada **300ms** (en silencio, sin hablar) → **fluye perfecto** en las gafas. ⇒ el BLE **sí aguanta** ese ritmo de escritura cuando no hay audio subiendo.
- **Con habla real** → las gafas se congelan en el **primer write** (`U1 T1 D2`), pero el **tracer en la UI del teléfono (DOM, sin BLE) sigue avanzando** los contadores `U/T/D`. ⇒ el pipeline STT→traducir→drip está **vivo**; lo que muere es **la escritura BLE a las gafas**, y solo **cuando el mic está subiendo audio a la vez** (`audioControl(true)` + Deepgram activos).
- **Hipótesis primaria a probar:** contención del enlace BLE entre el **audio uplink** (mic de las gafas → `bridge.audioControl`) y el **display downlink** (`textContainerUpgrade`). El simulador no tiene BLE real → nunca se congela. El timeout de 2s no basta porque **cada** write subsiguiente vuelve a colgarse mientras el audio compite.

**Instrumentación de diagnóstico DEJADA EN EL CÓDIGO (quitar antes de empaquetar):**
- `src/main.ts`: bandera `DIAG_TRACE = true` → un `trace()` que NO dibuja el contenido real; en su lugar vuelca `U# T# D# dq# | gw a/b/c/d` en el **chip de estado del teléfono** y en las gafas. `gw` = contadores de `GlassesStage`: escrituras **iniciadas/ok/timeout/error**.
- `src/glasses-render.ts`: contadores públicos `writesStarted/writesOk/writesTimedOut/writesErr`.
- Para volver al render real: poner `DIAG_TRACE = false` (o borrar el bloque tracer + los contadores).

**Próximos pasos al retomar:** (1) leer en el teléfono el contador `gw` durante el freeze: si **timeout (3er nº) sube** ⇒ los writes se cuelgan (confirma contención); si **ok == iniciadas** pero gafas congeladas ⇒ los writes tienen ACK pero el firmware no repinta. (2) Probar mitigaciones de contención: pausar/espaciar `audioControl` durante el write, throttlear writes a ~1/s mostrando solo la última palabra, o serializar para no tener audio-up + display-down simultáneos. (3) Si es límite del firmware/SDK, consultar el `everything-evenhub:sdk-reference` por rate limits de `textContainerUpgrade` concurrente con captura de audio.

**⚠️ GOTCHA CONFIRMADO (2026-06-22) — el HMR NO llega al WebView del teléfono:** guardar el archivo recarga el **simulador** pero **NO las gafas/teléfono**. Tras **cada** cambio de código hay que **re-escanear el QR** para cargar el bundle nuevo (un freeze "que no se arregla con el fix" suele ser código viejo cacheado). Esto contradice la nota previa de "hot-reload en gafas" — no es confiable.

**Cómo retomar (sesión cerrada 2026-06-22, dev server quizá detenido):** (1) `cd /Users/juanf/oneword && npm run dev`; (2) `npx evenhub qr --url http://$(ipconfig getifaddr en0):5173` **desde la carpeta del proyecto**; (3) Even Hub tab → Scan QR (Developer Mode ya activo); (4) **re-escanear el QR tras cada edición** (el HMR no basta); (5) la instrumentación `DIAG_TRACE` ya está puesta para leer los contadores en el teléfono.

### ⚙️ GOTCHA — activar Developer Mode para sideload (resuelto 2026-06-19, no obvio)

El "Developer Center" / "Scan QR" **NO aparece en la app iOS** hasta activar Developer Mode, y eso **no es un toggle ni un gesto en las gafas**: (1) login en `hub.evenrealities.com/login` con la **misma cuenta** de la app (`juanchobernal@gmail.com`), (2) **force-quit de la app** (deslizarla del app-switcher, no solo background) y reabrir, (3) aparece la sección de desarrollador **arriba-derecha en la pestaña "Even Hub"** → "Scan QR". Sin el force-quit no aparece aunque ya seas dev registrado. Local testing = Even Hub tab → Scan QR (apuntar a la terminal con el QR).

**Camino al `.ehpk` privado** (siguiente fase tras resolver el bug de render):

1. [x] **Probar end-to-end en dev — HECHO (2026-06-19).** `npm run dev` + simulador con `--automation-port 9898`, hablándole al mic del Mac, los 3 modos validados con screenshots de las gafas: modo 1 translate-word ("RÁPIDO."), modo 2 transcribe-word ("TODAY?", idioma original sin traducir), modo 3 translate-sentence ("VINCULADO A LAS GRANDES FARMACÉUTICAS"). Deepgram + Google Translate OK, 0 errores. Verificado vía log `[diag]` temporal que `onLatestWord` llega en modo 2 (el "blank" inicial fue timing del screenshot, no bug). `WORD_DRIP_MS=350` se sintió bien, no se ajustó.
2. [x] **Sideload en gafas reales — FUNCIONA (2026-06-19), con bug de render abierto (ver abajo).** `cd /Users/juanf/oneword && npx evenhub qr --url http://<IP-LAN>:5173` (IP del Mac en WiFi, p.ej. `192.168.86.247`; **correr DESDE la carpeta del proyecto** o `evenhub` da 404 npm). Oneword carga y corre en las gafas físicas con hot-reload. Confirmado: las llamadas Deepgram + Google funcionan desde el teléfono.
3. [ ] **Verificar `app.json` antes de empaquetar — HECHO, está OK**: `min_sdk_version=0.0.10`, `name` ≤20 chars, permisos `g2-microphone` + `network` con whitelist `api.deepgram.com` + `translation.googleapis.com`. (`package_id=com.example.oneword` usa namespace placeholder; irrelevante para privado.)
4. [ ] `npm run build` → `tsc --noEmit && vite build` produce `dist/`. (Type-check ya pasa limpio.)
5. [ ] **Empaquetar — sintaxis correcta** (la doc del CLI difiere del comando viejo): `npx evenhub pack app.json dist -o oneword-0.1.0.ehpk`. Las llaves `.env.local` quedan **bakeadas en el bundle** — ver Gotcha #1; aceptable porque la app es privada.
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
