import { MODES, MODE_LABELS, type Mode } from './modes'
import { TARGET_LANGS } from './langs'

type Status = 'connecting' | 'listening' | 'error'

let transcriptEl: HTMLDivElement
let translationEl: HTMLDivElement
let translationLabelEl: HTMLDivElement
let langChipEl: HTMLSpanElement
let targetSelectEl: HTMLSelectElement
let buildEl: HTMLSpanElement
let modeButtons: Map<Mode, HTMLButtonElement> = new Map()

let onModeChange: ((m: Mode) => void) | null = null
let onTargetLangChange: ((code: string) => void) | null = null

export function mountUi(
  initialMode: Mode,
  modeChangeHandler: (m: Mode) => void,
  initialTargetLang: string,
  targetLangChangeHandler: (code: string) => void,
) {
  onModeChange = modeChangeHandler
  onTargetLangChange = targetLangChangeHandler
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <main class="panel">
      <header>
        <h1>Onephrase <span id="build" class="build"></span></h1>
        <div class="head-right">
          <span id="lang" class="chip chip-muted">— →</span>
          <select id="target-lang" class="lang-select" aria-label="Translation language">
            ${TARGET_LANGS.map(l => `<option value="${l.code}">${l.label}</option>`).join('')}
          </select>
        </div>
      </header>
      <section class="modes" role="radiogroup" aria-label="Modo">
        ${MODES.map(
          m => `<button class="mode-btn" data-mode="${m}" role="radio" aria-checked="false">${MODE_LABELS[m]}</button>`,
        ).join('')}
      </section>
      <section class="boards">
        <div class="board">
          <div class="board-label">Transcription</div>
          <div id="transcript" class="board-body" aria-live="polite"></div>
        </div>
        <div class="board">
          <div id="translation-label" class="board-label">Translation (ES)</div>
          <div id="translation" class="board-body" aria-live="polite"></div>
        </div>
      </section>
      <footer>Single-tap the glasses temple to switch mode · double-tap to exit.</footer>
    </main>
  `
  transcriptEl = app.querySelector<HTMLDivElement>('#transcript')!
  translationEl = app.querySelector<HTMLDivElement>('#translation')!
  translationLabelEl = app.querySelector<HTMLDivElement>('#translation-label')!
  langChipEl = app.querySelector<HTMLSpanElement>('#lang')!
  targetSelectEl = app.querySelector<HTMLSelectElement>('#target-lang')!
  buildEl = app.querySelector<HTMLSpanElement>('#build')!

  targetSelectEl.value = initialTargetLang
  targetSelectEl.addEventListener('change', () => onTargetLangChange?.(targetSelectEl.value))

  for (const btn of app.querySelectorAll<HTMLButtonElement>('.mode-btn')) {
    const m = btn.dataset.mode as Mode
    modeButtons.set(m, btn)
    btn.addEventListener('click', () => onModeChange?.(m))
  }
  setActiveMode(initialMode)
  setTargetLang(initialTargetLang) // sync the board label to the persisted choice
  injectStyles()
}

// Reflect the chosen target language: keep the dropdown in sync (e.g. when set
// programmatically) and update the translation board label.
export function setTargetLang(code: string) {
  if (targetSelectEl && targetSelectEl.value !== code) targetSelectEl.value = code
  if (translationLabelEl) translationLabelEl.textContent = `Translation (${code.toUpperCase()})`
}

// Build/version tag next to the title — lets you confirm which bundle loaded
// (must match the ?v=N you scanned).
export function setBuildInfo(text: string) {
  if (buildEl) buildEl.textContent = text
}

export function setActiveMode(mode: Mode) {
  for (const [m, btn] of modeButtons) {
    const active = m === mode
    btn.classList.toggle('mode-btn-active', active)
    btn.setAttribute('aria-checked', active ? 'true' : 'false')
  }
  // The target-language picker only applies when translating.
  if (targetSelectEl) targetSelectEl.disabled = mode !== 'translate'
}

// The single header chip shows the detected language ("auto → es"). Errors are
// the only status that takes it over (red), so connection/mic problems stay
// visible; normal states (connecting/listening) leave the language showing.
export function setStatus(kind: Status, text: string) {
  if (!langChipEl) return
  if (kind === 'error') {
    langChipEl.className = 'chip chip-error'
    langChipEl.textContent = text
  } else {
    langChipEl.classList.remove('chip-error')
    langChipEl.classList.add('chip-muted')
  }
}

export function setDetectedLanguage(lang: string) {
  if (!langChipEl) return
  langChipEl.classList.remove('chip-error')
  langChipEl.classList.add('chip-muted')
  // Detected SOURCE language, with an arrow pointing at the target dropdown
  // beside it: "EN → [ Spanish ▾ ]".
  langChipEl.textContent = `${lang} →`
}

export function setTranscript(text: string) {
  if (transcriptEl) transcriptEl.textContent = text
}

export function setTranslation(text: string) {
  if (translationEl) translationEl.textContent = text
}

function injectStyles() {
  const css = `
    :root { color-scheme: dark; }
    html, body { margin: 0; height: 100%; background: #232323; color: #E5E5E5;
      font: 16px/1.4 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', system-ui, sans-serif;
      touch-action: manipulation; -webkit-text-size-adjust: 100%;
      overscroll-behavior: none; }
    #app { display: flex; height: 100%; }
    .panel { display: flex; flex-direction: column; gap: 14px;
      width: 100%; max-width: 720px; margin: 0 auto; padding: 20px; box-sizing: border-box; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .head-right { display: flex; align-items: center; gap: 8px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: 0.02em; }
    .chip { font-size: 11px; padding: 4px 9px; border-radius: 999px;
      border: 1px solid #3E3E3E; color: #A7A7A7; letter-spacing: 0.04em; text-transform: uppercase; }
    .chip-muted { background: #2E2E2E; }
    .chip-error { background: rgba(255,69,58,0.12); border-color: #FF453A; color: #FF453A; text-transform: none; }
    .lang-select { appearance: none; -webkit-appearance: none; cursor: pointer;
      background: #2E2E2E; color: #E5E5E5; border: 1px solid #3E3E3E;
      border-radius: 999px; padding: 4px 26px 4px 11px; font-size: 12px;
      letter-spacing: 0.02em; line-height: 1.2;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%23A7A7A7' stroke-width='1.5'/></svg>");
      background-repeat: no-repeat; background-position: right 9px center; }
    .lang-select:disabled { opacity: 0.4; cursor: not-allowed; }
    .build { font-size: 12px; font-weight: 400; color: #FF9F0A; letter-spacing: 0.02em; }
    .modes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .mode-btn { appearance: none; cursor: pointer; padding: 12px 10px;
      background: #2E2E2E; color: #E5E5E5; border: 1px solid #3E3E3E;
      border-radius: 10px; font-size: 13px; font-weight: 500; text-align: center;
      transition: background 80ms ease, border-color 80ms ease, color 80ms ease; }
    .mode-btn:hover { background: #3A3A3A; }
    .mode-btn-active { background: rgba(60,250,68,0.12); color: #3CFA44;
      border-color: #3CFA44; }
    .boards { flex: 1; display: grid; grid-template-rows: 1fr 1fr; gap: 12px; min-height: 0; }
    .board { display: flex; flex-direction: column;
      background: #2E2E2E; border: 1px solid #3E3E3E; border-radius: 12px; overflow: hidden; min-height: 0; }
    .board-label { padding: 8px 14px; font-size: 11px; color: #A7A7A7;
      letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid #3E3E3E; }
    .board-body { flex: 1; padding: 16px; font-size: 18px; line-height: 1.5;
      overflow: auto; white-space: pre-wrap; word-break: break-word; color: #E5E5E5; min-height: 0; }
    footer { font-size: 12px; color: #7B7B7B; text-align: center; }
  `
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}
