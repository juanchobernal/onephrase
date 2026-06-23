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

  clear() {
    this.setRaw('')
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
