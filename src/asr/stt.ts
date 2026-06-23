// Deepgram streaming STT client for the G2 microphone.
//
// G2 mic emits PCM s16le @ 16 kHz mono via `bridge.audioControl(true)`.
// Each onEvenHubEvent callback with `audioEvent.audioPcm` delivers a chunk
// we forward straight into the Deepgram WebSocket.
//
// Three event streams are exposed:
//
//   onLatestWord(w)  — fires whenever the trailing word of the in-progress
//                      utterance changes (interim or final). Used by
//                      transcription word-by-word (mode 2) — the screen
//                      shows whatever word the speaker is on right now.
//
//   onUtterance(u)   — fires once per finished utterance with the full
//                      punctuated transcript and detected language.
//                      Used by translation modes (1, 3).
//
//   onStatus / onError — connection + error reporting for the UI chip.
//
// Browsers can't set Authorization headers on WebSocket, so we pass the API
// key via the Sec-WebSocket-Protocol header — Deepgram accepts a
// "token,<key>" subprotocol pair.

export interface SttUtterance {
  transcript: string
  detectedLang: string
}

export interface SttCallbacks {
  onLatestWord?: (word: string) => void
  onUtterance?: (u: SttUtterance) => void
  onStatus?: (s: 'connecting' | 'open' | 'closed') => void
  onError?: (err: unknown) => void
}

export interface SttClient {
  sendPcm(chunk: Uint8Array): void
  close(): void
}

// NOTE: `detect_language=true` is NOT supported on the streaming WebSocket
// (returns HTTP 400 on both nova-2 and nova-3 — it's a batch-only feature).
// For real-time multilingual auto-detection we use nova-3 with
// `language=multi`, which transcribes mixed-language speech and reports the
// per-word language (used only for the UI chip; Google auto-detects on its end).
const DEEPGRAM_URL =
  'wss://api.deepgram.com/v1/listen' +
  '?model=nova-3' +
  '&language=multi' +
  '&encoding=linear16' +
  '&sample_rate=16000' +
  '&channels=1' +
  '&interim_results=true' +
  '&punctuate=true' +
  '&smart_format=true' +
  '&utterance_end_ms=1000' + // mínimo de Deepgram; no baja más
  // endpointing = ms de silencio antes de marcar speech_final (cierra la frase).
  // Subido a 300 para cerrar en fronteras de ORACIÓN natural (no a media idea):
  // mejor contexto de traducción y menos parpadeo de pantalla. Ya no bajamos a
  // 150 porque la acumulación de is_final + el catch-up (sin descartar frases)
  // evitan el "saltarse frases" que antes intentábamos resolver fragmentando.
  '&endpointing=300'

export function startSttStream(apiKey: string, cb: SttCallbacks): SttClient {
  if (!apiKey) throw new Error('Deepgram API key missing — set VITE_DEEPGRAM_API_KEY in .env.local')

  cb.onStatus?.('connecting')
  const ws = new WebSocket(DEEPGRAM_URL, ['token', apiKey])
  ws.binaryType = 'arraybuffer'

  const pendingChunks: Uint8Array[] = []
  let isOpen = false
  let closed = false

  // Trailing word of the in-progress utterance. Re-emitted only when it
  // actually changes — avoids flooding the UI with duplicate events.
  let lastTrailingWord = ''

  // Accumulated finalized transcript for the current utterance. Deepgram may
  // split one utterance into several is_final messages, each carrying only its
  // own segment — so we append them here and flush the whole buffer at the end.
  // Flushing on speech_final alone (the previous code) dropped earlier segments.
  let finalBuffer = ''
  let lastLang = 'unknown'

  // Safety net only. Normally speech_final/UtteranceEnd close phrases at natural
  // sentence pauses (endpointing=300). This just stops a pause-less monologue
  // from growing into an unbounded blob — set high so we DON'T cut mid-sentence
  // (cutting at 8 words hurt translation quality and readability).
  const FLUSH_MAX_WORDS = 24

  // Emit the accumulated utterance once and reset. Guarded so a stray flush
  // (e.g. an UtteranceEnd arriving after speech_final already cleared the
  // buffer) does nothing instead of emitting an empty/duplicate phrase.
  function flushUtterance() {
    const transcript = finalBuffer.trim()
    if (!transcript) return
    cb.onUtterance?.({ transcript, detectedLang: lastLang })
    finalBuffer = ''
    lastTrailingWord = ''
  }

  ws.addEventListener('open', () => {
    isOpen = true
    cb.onStatus?.('open')
    for (const chunk of pendingChunks) ws.send(chunk)
    pendingChunks.length = 0
  })

  ws.addEventListener('message', evt => {
    if (typeof evt.data !== 'string') return
    let msg: any
    try {
      msg = JSON.parse(evt.data)
    } catch {
      return
    }
    if (msg.type === 'Results') handleResults(msg)
    // UtteranceEnd is the fallback finalizer: when background noise keeps the
    // VAD from emitting speech_final, Deepgram still detects the word-gap and
    // sends this. A no-op if speech_final already flushed the buffer.
    else if (msg.type === 'UtteranceEnd') flushUtterance()
  })

  ws.addEventListener('error', err => {
    cb.onError?.(err)
  })

  ws.addEventListener('close', () => {
    isOpen = false
    closed = true
    cb.onStatus?.('closed')
  })

  function handleResults(msg: any) {
    const alt = msg.channel?.alternatives?.[0]
    if (!alt) return
    const transcript: string = (alt.transcript ?? '').trim()
    const words: any[] = alt.words ?? []
    const isFinal: boolean = !!msg.is_final
    const speechFinal: boolean = !!msg.speech_final
    // nova-3 multi reports language per word; fall back to channel/alt fields.
    const lastWordLang = words.length ? words[words.length - 1]?.language : undefined
    const detectedLang: string =
      msg.channel?.detected_language ?? alt.detected_language ?? lastWordLang ?? 'unknown'

    if (!transcript) return

    // Trailing word — what the speaker is currently saying.
    const tail = words.length ? words[words.length - 1] : null
    if (tail) {
      const tailText: string = (tail.punctuated_word ?? tail.word ?? '').trim()
      if (tailText && tailText !== lastTrailingWord) {
        lastTrailingWord = tailText
        cb.onLatestWord?.(tailText)
      }
    }

    // A finalized segment: append it to the utterance buffer (Deepgram won't
    // revise these words). Interim results (is_final=false) only drive the
    // live word mirror above and never touch the buffer.
    if (isFinal) {
      finalBuffer = finalBuffer ? `${finalBuffer} ${transcript}` : transcript
      lastLang = detectedLang
      // Long monologue with no pause: flush once the buffer reaches a
      // glance-sized phrase instead of waiting for speech_final.
      const wordCount = finalBuffer.split(/\s+/).filter(Boolean).length
      if (wordCount >= FLUSH_MAX_WORDS) flushUtterance()
    }

    // speech_final marks the end of the utterance via silence — flush the
    // accumulated buffer (which may span several is_final segments). A no-op
    // if the word-cap above already flushed it.
    if (speechFinal) flushUtterance()
  }

  return {
    sendPcm(chunk) {
      if (closed) return
      if (isOpen) ws.send(chunk)
      else pendingChunks.push(chunk)
    },
    close() {
      if (closed) return
      closed = true
      try {
        if (isOpen) ws.send(JSON.stringify({ type: 'CloseStream' }))
        ws.close()
      } catch {
        // ignore
      }
    },
  }
}
