// Target languages for translation (Google Translate v2 codes). Picked on the
// phone; the choice persists via bridge.setLocalStorage. The source language is
// always auto-detected, so this only sets the destination.

export interface TargetLang {
  code: string // ISO code Google Translate v2 expects
  label: string // shown in the phone dropdown
}

export const TARGET_LANGS: TargetLang[] = [
  { code: 'es', label: 'Spanish' },
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italian' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
]

export const DEFAULT_TARGET_LANG = 'es'

export function isValidTargetLang(code: string): boolean {
  return TARGET_LANGS.some(l => l.code === code)
}

export function targetLangLabel(code: string): string {
  return TARGET_LANGS.find(l => l.code === code)?.label ?? code.toUpperCase()
}
