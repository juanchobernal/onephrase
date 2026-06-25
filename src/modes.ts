// The 2 user-facing modes. Selected on the phone, cycled with single-tap on
// the glasses. Both operate at the SENTENCE level: the display is written once
// per utterance, AFTER the speaker pauses — writing mid-speech starves the BLE
// link (the mic audio uplink saturates it) and freezes the display.

export type Mode = 'translate' | 'transcribe'

export const MODES: Mode[] = ['translate', 'transcribe']

export const MODE_LABELS: Record<Mode, string> = {
  translate: 'translate · phrase',
  transcribe: 'transcribe · phrase',
}

// Lowercase labels shown briefly on the glasses when the mode cycles. Rendered
// with upper=false so they stay lowercase (translated/transcribed content is
// still uppercased).
export const MODE_GLASSES_LABELS: Record<Mode, string> = {
  translate: 'translate',
  transcribe: 'transcribe',
}

// Base labels for the idle menu on the glasses, in ENGLISH (one line, both
// modes shown). formatMenu() lowercases both and wraps the ACTIVE one in
// [brackets] — the G2 text API has no per-word brightness, so a bracket marker
// is the cleanest active cue in plain text.
export const MODE_MENU_LABELS: Record<Mode, string> = {
  translate: 'Translator',
  transcribe: 'Transcription',
}

export function nextMode(current: Mode): Mode {
  const idx = MODES.indexOf(current)
  return MODES[(idx + 1) % MODES.length]
}

export function isTranslationMode(mode: Mode): boolean {
  return mode === 'translate'
}
