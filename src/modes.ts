// The 2 user-facing modes. Selected on the phone, cycled with single-tap on
// the glasses. Both operate at the SENTENCE level: the display is written once
// per utterance, AFTER the speaker pauses — writing mid-speech starves the BLE
// link (the mic audio uplink saturates it) and freezes the display.

export type Mode = 'translate' | 'transcribe'

export const MODES: Mode[] = ['translate', 'transcribe']

export const MODE_LABELS: Record<Mode, string> = {
  translate: 'traducción · frase',
  transcribe: 'transcripción · frase',
}

// Lowercase labels shown briefly on the glasses when the mode cycles. Rendered
// with upper=false so they stay lowercase (translated/transcribed content is
// still uppercased).
export const MODE_GLASSES_LABELS: Record<Mode, string> = {
  translate: 'traducción',
  transcribe: 'transcripción',
}

// Capitalized labels for the idle menu on the glasses (one line per mode, the
// active one marked). Shown while no phrase is on screen, so the app signals
// it's still alive and which mode is active.
export const MODE_MENU_LABELS: Record<Mode, string> = {
  translate: 'Traductor',
  transcribe: 'Transcripción',
}

export function nextMode(current: Mode): Mode {
  const idx = MODES.indexOf(current)
  return MODES[(idx + 1) % MODES.length]
}

export function isTranslationMode(mode: Mode): boolean {
  return mode === 'translate'
}
