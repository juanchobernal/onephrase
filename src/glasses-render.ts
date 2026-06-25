// Pixel-centered, uppercase renderer for the G2 display (576x288).
//
// The SDK's TextContainer has no font-size / no text-align — text is drawn
// with one fixed font at 27 px line height, left-aligned inside the
// container's padding box. To "center large" we:
//
//   • Use a single full-canvas container with padding 0.
//   • Pad lines with leading spaces so each line sits centered horizontally.
//   • Pad blank lines on top so the block sits centered vertically.
//
// All renders go through `update()` which debounces BLE writes (~120 ms) —
// without debouncing the queue backs up and the display lags noticeably.

import {
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext'

export const CANVAS_W = 576
export const CANVAS_H = 288
export const LINE_H = 27
export const CONTAINER_ID = 1
export const CONTAINER_NAME = 'stage'

const SPACE_W = getTextWidth(' ') || 5 // hard fallback if pretext returns 0

function spacesForLeftPad(linePx: number, maxW: number): string {
  const slack = maxW - linePx
  if (slack <= 0) return ''
  const n = Math.round(slack / 2 / SPACE_W)
  return n > 0 ? ' '.repeat(n) : ''
}

function blankLinesForVerticalPad(textPx: number, maxH: number): string {
  const slack = maxH - textPx
  if (slack <= 0) return ''
  const n = Math.floor(slack / 2 / LINE_H)
  return n > 0 ? '\n'.repeat(n) : ''
}

export function formatCenteredWord(word: string): string {
  const up = (word || '').toUpperCase().trim()
  if (!up) return ''
  const w = getTextWidth(up)
  const leftPad = spacesForLeftPad(w, CANVAS_W)
  const topPad = blankLinesForVerticalPad(LINE_H, CANVAS_H)
  return `${topPad}${leftPad}${up}`
}

export function formatCenteredSentence(sentence: string, upper = true): string {
  const norm = (sentence || '').trim()
  const up = upper ? norm.toUpperCase() : norm
  if (!up) return ''
  const wrap = measureTextWrap(up, CANVAS_W)

  // Re-wrap with the same algorithm so we know each line's text, then
  // left-pad each line independently. pretext gives us widths but not the
  // line texts, so we replay a simple greedy word wrap. This matches
  // pretext's behavior for normal whitespace-separated text.
  const lines = greedyWrap(up, CANVAS_W)
  const padded = lines
    .map((line, i) => {
      const px = wrap.lineWidths[i] ?? getTextWidth(line)
      return spacesForLeftPad(px, CANVAS_W) + line
    })
    .join('\n')

  const topPad = blankLinesForVerticalPad(lines.length * LINE_H, CANVAS_H)
  return `${topPad}${padded}`
}

// Idle menu: a single horizontal line, "op [translator] transcription", all
// lowercase with the active mode in [brackets]. `headerVisible` drives the
// blinking "OP":
// when false the slot is filled with spaces so the line keeps the same width
// and stays centered (no horizontal jitter as it blinks).
export interface MenuItem {
  label: string
  active: boolean
}

const MENU_HEADER = 'OP'
// Blank stand-in for "OP" while it blinks off. Must match "OP"'s PIXEL width,
// not its character count: "OP" is ~32px but two spaces are only ~10px, which
// is what made the rest of the line (Translator / Transcription) jump sideways
// on every blink. Space-granularity leaves at most ~half a space of residual.
const MENU_HEADER_BLANK = ' '.repeat(Math.round(getTextWidth(MENU_HEADER) / SPACE_W))

export function formatMenu(items: MenuItem[], headerVisible: boolean): string {
  // Everything lowercase; the active mode is marked with [brackets]. The G2
  // text API has no per-word color/brightness (only images support grayscale,
  // impractical for a blinking menu and capped at 288px wide), so a bracket
  // marker is the cleanest active cue achievable in plain text.
  const tail = items
    .map(i => (i.active ? `[${i.label.toLowerCase()}]` : i.label.toLowerCase()))
    .join('   ')
  // Center on the header-VISIBLE width so the line doesn't recenter on blink.
  const leftPad = spacesForLeftPad(getTextWidth(`${MENU_HEADER} ${tail}`), CANVAS_W)
  const head = headerVisible ? MENU_HEADER : MENU_HEADER_BLANK
  const topPad = blankLinesForVerticalPad(LINE_H, CANVAS_H)
  return `${topPad}${leftPad}${head} ${tail}`
}

// Top-left anchored phrase render. Unlike the centered formatter, text ALWAYS
// starts at the same fixed origin (constant top + left margin) and grows
// downward — so when a new phrase replaces the old one the reader's eye stays
// put instead of chasing a re-centered block. Natural case (no uppercasing).
const ANCHOR_TOP_LINES = 1 // constant blank lines above the text (breathing room)
const ANCHOR_LEFT_SPACES = 2 // constant left margin
// Usable text width once the fixed left margin is removed — the width every
// anchored phrase (and the chunker below) wraps against.
const ANCHOR_USABLE_W = CANVAS_W - ANCHOR_LEFT_SPACES * SPACE_W

export function formatAnchored(sentence: string): string {
  const norm = (sentence || '').trim()
  if (!norm) return ''
  const leftPad = ' '.repeat(ANCHOR_LEFT_SPACES)
  const lines = greedyWrap(norm, ANCHOR_USABLE_W).map(l => leftPad + l)
  return '\n'.repeat(ANCHOR_TOP_LINES) + lines.join('\n')
}

// ─── Reading-sized chunking ───────────────────────────────────────────────
// A whole sentence can still wrap to 3-4 lines — too much to glance-read. We
// break long phrases into ≤MAX_PHRASE_LINES-line chunks at natural boundaries
// (subtitle style): after a comma/semicolon/colon, or before a conjunction.
// Only when no boundary fits do we hard-wrap by words. Chunking runs on the
// FINAL displayed text (after translation), since translation changes length.

const MAX_PHRASE_LINES = 2

// Lowercased words that introduce a clause — soft break points when there's no
// comma. Spanish first, then a few English ones (auto-detect can yield either).
const CLAUSE_CONJUNCTIONS = new Set([
  'y', 'e', 'o', 'u', 'pero', 'porque', 'pues', 'que', 'como', 'cuando',
  'aunque', 'mientras', 'sino', 'donde', 'quien', 'cuyo',
  'and', 'or', 'but', 'because', 'that', 'when', 'while', 'if', 'where',
])

function lineCount(text: string): number {
  return measureTextWrap(text, ANCHOR_USABLE_W).lineCount
}

// Strip surrounding punctuation so "y," / "(pero" still match the conjunction set.
function bareWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}]/gu, '')
}

// Split into clause-sized segments: start a new segment before a conjunction
// (never on the first word) and end one after a word carrying , ; or :
function clauseSegments(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const segs: string[] = []
  let cur: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (cur.length && i > 0 && CLAUSE_CONJUNCTIONS.has(bareWord(w))) {
      segs.push(cur.join(' '))
      cur = []
    }
    cur.push(w)
    if (/[,;:]$/.test(w)) {
      segs.push(cur.join(' '))
      cur = []
    }
  }
  if (cur.length) segs.push(cur.join(' '))
  return segs
}

// Last resort: pack words greedily into ≤maxLines-line pieces. A single word
// always fits (it can't exceed the line on its own here).
function hardWrapWords(text: string, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w
    if (lineCount(cand) <= maxLines) {
      cur = cand
    } else {
      if (cur) out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)
  return out
}

// Break `text` into chunks each rendering to ≤maxLines lines. Returns [text]
// unchanged when it already fits.
export function chunkForReading(text: string, maxLines = MAX_PHRASE_LINES): string[] {
  const norm = (text || '').trim()
  if (!norm) return []
  if (lineCount(norm) <= maxLines) return [norm]

  const chunks: string[] = []
  let cur = ''
  for (const seg of clauseSegments(norm)) {
    const cand = cur ? `${cur} ${seg}` : seg
    if (lineCount(cand) <= maxLines) {
      cur = cand
      continue
    }
    if (cur) {
      chunks.push(cur)
      cur = ''
    }
    // The segment alone may still overflow (a long clause with no inner break).
    if (lineCount(seg) > maxLines) {
      chunks.push(...hardWrapWords(seg, maxLines))
    } else {
      cur = seg
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}

function greedyWrap(text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (getTextWidth(candidate) <= maxW) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

// Debounced container updater. Multiple set*() calls within DEBOUNCE_MS
// collapse to one BLE write — important so we don't congest the queue.
const DEBOUNCE_MS = 120

// Hard cap for a single BLE write. On real glasses, textContainerUpgrade()
// can hang forever if the write never gets ACKed — without this the
// `inflight` lock would stay true and freeze ALL future renders. Racing
// against this timeout guarantees the lock is always released.
const WRITE_TIMEOUT_MS = 2000

const WRITE_TIMED_OUT = Symbol('write-timeout')

function timeout(ms: number): Promise<typeof WRITE_TIMED_OUT> {
  return new Promise((resolve) =>
    window.setTimeout(() => resolve(WRITE_TIMED_OUT), ms),
  )
}

export class GlassesStage {
  private bridge: EvenAppBridge
  private pendingContent: string | null = null
  private lastWritten = ''
  private timer: number | null = null
  private inflight = false

  constructor(bridge: EvenAppBridge) {
    this.bridge = bridge
  }

  setRaw(content: string) {
    this.pendingContent = content
    this.schedule()
  }

  setCenteredWord(word: string) {
    this.setRaw(formatCenteredWord(word))
  }

  setCenteredSentence(sentence: string, upper = true) {
    this.setRaw(formatCenteredSentence(sentence, upper))
  }

  setAnchoredSentence(sentence: string) {
    this.setRaw(formatAnchored(sentence))
  }

  clear() {
    // NOT '' — the G2 treats empty content as "no change" and leaves the old
    // text on screen. A single space replaces the content with a blank line,
    // which visibly clears the display.
    this.setRaw(' ')
  }

  private schedule() {
    if (this.timer !== null) return
    this.timer = window.setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  private async flush() {
    this.timer = null
    if (this.inflight) {
      // Re-schedule once the in-flight call resolves
      this.schedule()
      return
    }
    if (this.pendingContent === null) return
    const next = this.pendingContent
    this.pendingContent = null
    if (next === this.lastWritten) return
    this.lastWritten = next
    this.inflight = true
    try {
      const result = await Promise.race([
        this.bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: CONTAINER_ID,
            containerName: CONTAINER_NAME,
            content: next,
          }),
        ),
        timeout(WRITE_TIMEOUT_MS),
      ])
      if (result === WRITE_TIMED_OUT) {
        // The write may never have reached the glasses. Drop the dedupe
        // marker so the same content can be re-sent on the next flush.
        console.warn('textContainerUpgrade timed out, releasing lock')
        this.lastWritten = ''
      }
    } catch (err) {
      console.error('textContainerUpgrade failed', err)
      this.lastWritten = ''
    } finally {
      this.inflight = false
      if (this.pendingContent !== null) this.schedule()
    }
  }
}
