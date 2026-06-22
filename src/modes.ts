// The 2 user-facing modes. Selected on the phone, cycled with single-tap on
// the glasses. Both operate at the SENTENCE level: the display is written once
// per utterance, AFTER the speaker pauses — writing mid-speech starves the BLE
// link (the mic audio uplink saturates it) and freezes the display.

export type Mode = 'translate' | 'transcribe'

export const MODES: Mode[] = ['translate', 'transcribe']

export const MODE_LABELS: Record<Mode, string> = {
  translate: 'Traducción · frase',
  transcribe: 'Transcripción · frase',
}

// Short uppercase labels shown briefly on the glasses when the mode cycles.
export const MODE_GLASSES_LABELS: Record<Mode, string> = {
  translate: 'TRADUCCIÓN',
  transcribe: 'TRANSCRIPCIÓN',
}

export function nextMode(current: Mode): Mode {
  const idx = MODES.indexOf(current)
  return MODES[(idx + 1) % MODES.length]
}

export function isTranslationMode(mode: Mode): boolean {
  return mode === 'translate'
}
