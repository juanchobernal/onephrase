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
  formatMenu,
  CANVAS_W,
  CANVAS_H,
  CONTAINER_ID,
  CONTAINER_NAME,
} from './glasses-render'
import { MODES, MODE_MENU_LABELS, nextMode, type Mode } from './modes'
import {
  mountUi,
  setStatus,
  setActiveMode,
  setDetectedLanguage,
  setTranscript,
  setTranslation,
  setBuildInfo,
} from './ui'

// Bump this with every change and keep it in sync with the ?v=N in the QR URL,
// so the app shows which bundle is actually loaded (cache-bust verification).
const BUILD = 'v14'

const TARGET_LANG = 'es'
const MODE_STORAGE_KEY = 'onephrase:mode'
const BLINK_MS = 800               // "OP" blink period in the idle menu

const DEEPGRAM_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY as string
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string

let currentMode: Mode = 'translate'
// Idle menu state: shown at startup and after IDLE_CLEAR_MS of silence. The
// blink timer toggles the "OP" header on/off; a phrase arriving exits the menu.
let menuActive = false
let blinkOn = true
let blinkTimer: number | null = null

// Phrase display queue — every finalized phrase is shown for a time that
// SCALES WITH ITS LENGTH: longer phrases get more reading time, single words
// don't linger. So none is skipped and none overstays. Writes stay
// sentence-level and spaced, well under the BLE rate that froze the word drip.
const PHRASE_BASE_MS = 750       // fixed time to notice + start reading
const PHRASE_PER_WORD_MS = 290   // added per word (calibrated to the user's reading-time table)
const PHRASE_MIN_MS = 1100       // floor (e.g. a single short word)
const PHRASE_MAX_MS = 4500       // ceiling (a very long phrase)
const PHRASE_CATCHUP_MS = 800    // brief dwell while phrases are still queued behind (catch up, no drop)
const IDLE_CLEAR_MS = 20000      // wipe the glasses after this long with no new phrase
let phraseQueue: string[] = []
let phraseTimer: number | null = null
let idleClearTimer: number | null = null
let phraseGen = 0 // bumped on mode switch to drop stale queued/in-flight phrases
let translateChain: Promise<void> = Promise.resolve() // serializes translations to preserve order

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
setBuildInfo(BUILD)

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

// Rest in the idle menu at startup — it shows the persisted active mode.
enterMenu()

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

function handleUtterance(transcript: string, detectedLang: string) {
  setDetectedLanguage(detectedLang)
  setTranscript(transcript)

  // Transcribe: queue the spoken phrase verbatim, in its original language.
  if (currentMode === 'transcribe') {
    enqueuePhrase(transcript)
    return
  }

  // Translate: translate then queue. Serialize through translateChain so a
  // fast translation can't jump ahead of an earlier, slower one (order intact).
  const gen = phraseGen
  const text = transcript
  translateChain = translateChain.then(async () => {
    if (gen !== phraseGen) return // mode switched while queued — drop
    try {
      const translated = await translate(GOOGLE_KEY, text, TARGET_LANG)
      if (gen !== phraseGen) return
      setTranslation(translated)
      enqueuePhrase(translated)
    } catch (err) {
      setStatus('error', `Traducción: ${(err as Error)?.message ?? err}`)
      console.error('Translate failed:', err)
    }
  })
}

// Show each phrase for a length-scaled time so none is skipped and none
// overstays. A new phrase arriving while one is held just waits its turn; an
// empty queue draws at once.
function enqueuePhrase(text: string) {
  const t = (text || '').trim()
  if (!t) return
  phraseQueue.push(t)
  // No phrase is ever dropped (that was the "skipping"). When we fall behind,
  // drainPhraseQueue shortens each phrase's dwell to catch up — like the
  // official app, but anchored so the text doesn't jump.
  if (phraseTimer === null) drainPhraseQueue()
}

// Reading time for a phrase: a base plus per-word, clamped. Tune the constants
// above if phrases feel too fast (raise) or linger too long (lower).
function dwellMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const ms = PHRASE_BASE_MS + words * PHRASE_PER_WORD_MS
  return Math.max(PHRASE_MIN_MS, Math.min(PHRASE_MAX_MS, ms))
}

function drainPhraseQueue() {
  const next = phraseQueue.shift()
  if (next === undefined) {
    phraseTimer = null
    return
  }
  exitMenu() // a phrase replaces the idle menu; stop the blink
  glasses.setAnchoredSentence(next) // fixed top-left origin so the eye stays put
  scheduleIdleClear()
  // If phrases are still queued behind, we're behind the speaker — show this
  // one only briefly so the backlog drains and the display stays close to real
  // time. Only the last phrase (empty queue) gets its full reading time.
  const ms = phraseQueue.length > 0 ? PHRASE_CATCHUP_MS : dwellMs(next)
  phraseTimer = window.setTimeout(drainPhraseQueue, ms)
}

// Reset the idle timer on every new phrase; when it expires (no phrase for
// IDLE_CLEAR_MS) fall back to the idle menu so stale text doesn't linger and
// the app still signals it's alive + which mode is active.
function scheduleIdleClear() {
  if (idleClearTimer !== null) clearTimeout(idleClearTimer)
  idleClearTimer = window.setTimeout(() => {
    idleClearTimer = null
    enterMenu()
  }, IDLE_CLEAR_MS)
}

// ─── Idle menu ────────────────────────────────────────────────────────

function drawMenu() {
  const items = MODES.map(m => ({ label: MODE_MENU_LABELS[m], active: m === currentMode }))
  glasses.setRaw(formatMenu(items, blinkOn))
}

function enterMenu() {
  menuActive = true
  // The menu is the resting state — cancel any pending idle fallback.
  if (idleClearTimer !== null) {
    clearTimeout(idleClearTimer)
    idleClearTimer = null
  }
  blinkOn = true
  drawMenu()
  if (blinkTimer === null) {
    blinkTimer = window.setInterval(() => {
      blinkOn = !blinkOn
      drawMenu()
    }, BLINK_MS)
  }
}

function exitMenu() {
  if (!menuActive) return
  menuActive = false
  if (blinkTimer !== null) {
    clearInterval(blinkTimer)
    blinkTimer = null
  }
}

// ─── Mode switching (phone + glasses tap) ─────────────────────────────

function switchMode(next: Mode, source: 'phone' | 'glasses') {
  if (next === currentMode) return
  currentMode = next
  setActiveMode(next)
  bridge.setLocalStorage(MODE_STORAGE_KEY, next).catch(() => {})
  // Drop any queued / in-flight phrases from the previous mode.
  phraseGen++
  phraseQueue = []
  if (phraseTimer !== null) {
    clearTimeout(phraseTimer)
    phraseTimer = null
  }

  // Show the idle menu so the new active mode is reflected immediately on the
  // glasses (replaces the old transient mode banner). The next phrase exits it.
  enterMenu()
  console.log(`mode → ${next} (via ${source})`)
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
  if (blinkTimer !== null) clearInterval(blinkTimer)
  if (phraseTimer !== null) clearTimeout(phraseTimer)
  if (idleClearTimer !== null) clearTimeout(idleClearTimer)
  bridge.audioControl(false)
  stt?.close()
  unsubscribe()
}

window.addEventListener('beforeunload', cleanup)
