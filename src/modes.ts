// The 3 user-facing modes. Selected on the phone, cycled with single-tap
// on the glasses. Order matters: tap cycles through MODES in this order.

export type Mode = 'translate-word' | 'transcribe-word' | 'translate-sentence'

export const MODES: Mode[] = ['translate-word', 'transcribe-word', 'translate-sentence']

export const MODE_LABELS: Record<Mode, string> = {
  'translate-word': 'Traducción · palabra',
  'transcribe-word': 'Transcripción · palabra',
  'translate-sentence': 'Traducción · frase',
}

// Short uppercase labels shown briefly on the glasses when the mode cycles.
export const MODE_GLASSES_LABELS: Record<Mode, string> = {
  'translate-word': 'TRADUCCIÓN · PALABRA',
  'transcribe-word': 'TRANSCRIPCIÓN · PALABRA',
  'translate-sentence': 'TRADUCCIÓN · FRASE',
}

export function nextMode(current: Mode): Mode {
  const idx = MODES.indexOf(current)
  return MODES[(idx + 1) % MODES.length]
}

export function isTranslationMode(mode: Mode): boolean {
  return mode === 'translate-word' || mode === 'translate-sentence'
}
