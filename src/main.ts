import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { startSttStream } from './asr/stt'
import { translate } from './asr/translate'
import {
  GlassesStage,
  CANVAS_W,
  CANVAS_H,
  CONTAINER_ID,
  CONTAINER_NAME,
} from './glasses-render'
import { MODES, MODE_GLASSES_LABELS, nextMode, type Mode } from './modes'
import {
  mountUi,
  setStatus,
  setActiveMode,
  setDetectedLanguage,
  setTranscript,
  setTranslation,
} from './ui'

const TARGET_LANG = 'es'
const MODE_BANNER_MS = 900         // how long the mode label flashes on the glasses when cycling
const MODE_STORAGE_KEY = 'onephrase:mode'

const DEEPGRAM_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY as string
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string

let currentMode: Mode = 'translate'
let modeBannerTimer: number | null = null

const bridge = await waitForEvenAppBridge()

// Persisted mode load — happens before the UI mounts so the picker shows
// the right active button on first paint.
try {
  const stored = await bridge.getLocalStorage(MODE_STORAGE_KEY)
  if (stored && (MODES as string[]).includes(stored)) currentMode = stored as Mode
} catch {
  // ignore — fall back to default mode
}

mountUi(currentMode, m => switchMode(m, 'phone'))

if (!DEEPGRAM_KEY) {
  setStatus('error', 'Falta VITE_DEEPGRAM_API_KEY — copia .env.example a .env.local')
}
if (!GOOGLE_KEY) {
  setStatus('error', 'Falta VITE_GOOGLE_API_KEY — copia .env.example a .env.local')
}

// One full-canvas container, no padding/border — the renderer pads with
// spaces and newlines to center text precisely.
const stage = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: CANVAS_W,
  height: CANVAS_H,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 0,
  containerID: CONTAINER_ID,
  containerName: CONTAINER_NAME,
  content: '',
  isEventCapture: 1,
})

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [stage] }),
)
if (created !== 0) {
  setStatus('error', `createStartUpPageContainer falló: ${created}`)
  console.error('Failed to create startup page')
}

const glasses = new GlassesStage(bridge)

// Show the mode label briefly when the app starts, then settle.
flashModeBanner(currentMode)

let stt: ReturnType<typeof startSttStream> | null = null
try {
  stt = startSttStream(DEEPGRAM_KEY, {
    onStatus(s) {
      if (s === 'open') setStatus('listening', 'Mic activo · doble toque sale')
      else if (s === 'connecting') setStatus('connecting', 'Conectando a Deepgram…')
      else if (s === 'closed') setStatus('error', 'Conexión cerrada')
    },
    onError(err) {
      setStatus('error', `STT: ${(err as Error)?.message ?? err}`)
      console.error('STT error:', err)
    },
    onLatestWord(word) {
      handleLatestWord(word)
    },
    onUtterance(u) {
      handleUtterance(u.transcript, u.detectedLang)
    },
  })
} catch (err) {
  setStatus('error', (err as Error)?.message ?? 'No pude iniciar el STT')
  console.error('STT startup failed:', err)
}

if (stt) {
  await bridge.audioControl(true)
}

// ─── Mode routing ─────────────────────────────────────────────────────
// Both modes write the glasses once per utterance — after the speaker pauses.
// Writing mid-speech starves the BLE link (mic audio uplink saturates it) and
// freezes the display, so per-word streaming is intentionally NOT done.

function handleLatestWord(word: string) {
  // Live mirror on the phone only — the in-progress word as it's heard.
  // The glasses are written per-sentence (on pause), never per-word.
  setTranscript(word)
}

let pendingUtteranceId = 0
async function handleUtterance(transcript: string, detectedLang: string) {
  setDetectedLanguage(detectedLang)
  setTranscript(transcript)

  // Transcribe: show the spoken phrase verbatim, in its original language.
  if (currentMode === 'transcribe') {
    glasses.setCenteredSentence(transcript)
    return
  }

  // Translate: render the Spanish translation of the full phrase. Invalidate
  // any earlier in-flight translation so a slow request doesn't clobber a
  // newer utterance.
  const myId = ++pendingUtteranceId
  let translated: string
  try {
    translated = await translate(GOOGLE_KEY, transcript, TARGET_LANG)
  } catch (err) {
    setStatus('error', `Traducción: ${(err as Error)?.message ?? err}`)
    console.error('Translate failed:', err)
    return
  }
  if (myId !== pendingUtteranceId) return // a newer utterance superseded this one

  setTranslation(translated)
  glasses.setCenteredSentence(translated)
}

// ─── Mode switching (phone + glasses tap) ─────────────────────────────

function switchMode(next: Mode, source: 'phone' | 'glasses') {
  if (next === currentMode) return
  currentMode = next
  setActiveMode(next)
  bridge.setLocalStorage(MODE_STORAGE_KEY, next).catch(() => {})
  // Invalidate any pending translation so it doesn't render under the new mode.
  pendingUtteranceId++

  flashModeBanner(next)
  console.log(`mode → ${next} (via ${source})`)
}

function flashModeBanner(mode: Mode) {
  glasses.setCenteredSentence(MODE_GLASSES_LABELS[mode])
  if (modeBannerTimer !== null) clearTimeout(modeBannerTimer)
  modeBannerTimer = window.setTimeout(() => {
    modeBannerTimer = null
    // Clear the banner only if nothing else has been drawn since.
    glasses.clear()
  }, MODE_BANNER_MS)
}

// ─── Event routing ────────────────────────────────────────────────────
// Protobuf omits zero-value fields, so CLICK_EVENT (= 0) arrives as a
// `sysEvent` object whose `eventType` is missing. Coalesce with `?? 0`
// ONLY when the envelope is present — otherwise we'd misclassify
// envelope-less events (audio) as clicks.
function envelopeEventType(env: { eventType?: number } | undefined): number | null {
  return env === undefined ? null : env.eventType ?? 0
}

// Single tap → cycle mode. Double tap → exit (confirm dialog).
const unsubscribe = bridge.onEvenHubEvent(event => {
  const pcm = event.audioEvent?.audioPcm
  if (pcm) stt?.sendPcm(pcm)

  const sysType = envelopeEventType(event.sysEvent)
  const textType = envelopeEventType(event.textEvent)

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1)
    return
  }

  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    switchMode(nextMode(currentMode), 'glasses')
    return
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup()
  }
})

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  if (modeBannerTimer !== null) clearTimeout(modeBannerTimer)
  bridge.audioControl(false)
  stt?.close()
  unsubscribe()
}

window.addEventListener('beforeunload', cleanup)
