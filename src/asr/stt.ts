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
//   onUtterance(u)   — fires once per finished SENTENCE with its punctuated
//                      transcript and detected language. A long utterance is
//                      emitted sentence-by-sentence as each one closes (at
//                      `. ! ? …`), so the first sentence paints without waiting
//                      for the speaker to fully stop. Used by both modes.
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

  // Emit the WHOLE accumulated buffer as one phrase and reset. Used for the
  // trailing fragment that has no sentence-ending punctuation (e.g. the speaker
  // stops mid-clause) on speech_final / UtteranceEnd, and for the word-cap
  // safety net. Guarded so a stray flush (e.g. an UtteranceEnd after the buffer
  // was already cleared) does nothing instead of emitting an empty phrase.
  function flushUtterance() {
    const transcript = finalBuffer.trim()
    if (!transcript) return
    cb.onUtterance?.({ transcript, detectedLang: lastLang })
    finalBuffer = ''
    lastTrailingWord = ''
  }

  // Split text into complete sentences plus a trailing remainder. A punctuation
  // mark counts as a sentence end only when it's at the end of the text or
  // followed by whitespace — so decimals ("12.5") and abbreviations ("Sr.")
  // mid-token don't trigger a false split.
  function splitSentences(text: string): { sentences: string[]; remainder: string } {
    const sentences: string[] = []
    let start = 0
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (c === '.' || c === '!' || c === '?' || c === '…') {
        const next = text[i + 1]
        if (next === undefined || /\s/.test(next)) {
          const s = text.slice(start, i + 1).trim()
          if (s) sentences.push(s)
          start = i + 1
        }
      }
    }
    return { sentences, remainder: text.slice(start) }
  }

  // Emit every COMPLETE sentence sitting in the buffer right now and keep the
  // trailing incomplete fragment for later. Called on each is_final so the
  // first sentence paints as soon as it closes (faster first paint) and long
  // speech is broken into sentence-sized phrases (shorter paragraphs) — without
  // ever cutting mid-idea, since we only split at terminal punctuation.
  function flushCompleteSentences() {
    const { sentences, remainder } = splitSentences(finalBuffer)
    if (sentences.length === 0) return
    for (const s of sentences) cb.onUtterance?.({ transcript: s, detectedLang: lastLang })
    finalBuffer = remainder.replace(/^\s+/, '')
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
      // Paint any sentence that just closed right away — don't wait for the
      // speaker to fully stop (that was the slow first paint). Whatever is left
      // is an incomplete trailing fragment that stays buffered.
      flushCompleteSentences()
      // Long monologue with no sentence break: flush the leftover fragment once
      // it reaches a glance-sized length instead of waiting for speech_final.
      const wordCount = finalBuffer.split(/\s+/).filter(Boolean).length
      if (wordCount >= FLUSH_MAX_WORDS) flushUtterance()
    }

    // speech_final marks the end of the utterance via silence — flush the
    // trailing fragment (a clause with no terminal punctuation). A no-op if the
    // sentence flush or word-cap above already emptied the buffer.
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
