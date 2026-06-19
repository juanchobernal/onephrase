import { MODES, MODE_LABELS, type Mode } from './modes'

type Status = 'connecting' | 'listening' | 'error'

let statusEl: HTMLDivElement
let transcriptEl: HTMLDivElement
let translationEl: HTMLDivElement
let langChipEl: HTMLSpanElement
let modeButtons: Map<Mode, HTMLButtonElement> = new Map()

let onModeChange: ((m: Mode) => void) | null = null

export function mountUi(initialMode: Mode, modeChangeHandler: (m: Mode) => void) {
  onModeChange = modeChangeHandler
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <main class="panel">
      <header>
        <h1>Oneword</h1>
        <div class="head-right">
          <span id="lang" class="chip chip-muted">idioma: —</span>
          <div id="status" class="status status-connecting">Conectando…</div>
        </div>
      </header>
      <section class="modes" role="radiogroup" aria-label="Modo">
        ${MODES.map(
          m => `<button class="mode-btn" data-mode="${m}" role="radio" aria-checked="false">${MODE_LABELS[m]}</button>`,
        ).join('')}
      </section>
      <section class="boards">
        <div class="board">
          <div class="board-label">Transcripción</div>
          <div id="transcript" class="board-body" aria-live="polite"></div>
        </div>
        <div class="board">
          <div class="board-label">Traducción (ES)</div>
          <div id="translation" class="board-body" aria-live="polite"></div>
        </div>
      </section>
      <footer>Toca una vez la patilla de las gafas para cambiar de modo · doble toque para salir.</footer>
    </main>
  `
  statusEl = app.querySelector<HTMLDivElement>('#status')!
  transcriptEl = app.querySelector<HTMLDivElement>('#transcript')!
  translationEl = app.querySelector<HTMLDivElement>('#translation')!
  langChipEl = app.querySelector<HTMLSpanElement>('#lang')!

  for (const btn of app.querySelectorAll<HTMLButtonElement>('.mode-btn')) {
    const m = btn.dataset.mode as Mode
    modeButtons.set(m, btn)
    btn.addEventListener('click', () => onModeChange?.(m))
  }
  setActiveMode(initialMode)
  injectStyles()
}

export function setActiveMode(mode: Mode) {
  for (const [m, btn] of modeButtons) {
    const active = m === mode
    btn.classList.toggle('mode-btn-active', active)
    btn.setAttribute('aria-checked', active ? 'true' : 'false')
  }
}

export function setStatus(kind: Status, text: string) {
  if (!statusEl) return
  statusEl.className = `status status-${kind}`
  statusEl.textContent = text
}

export function setDetectedLanguage(lang: string) {
  if (!langChipEl) return
  langChipEl.textContent = `idioma: ${lang}`
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
    .status { font-size: 12px; padding: 4px 10px; border-radius: 999px;
      border: 1px solid transparent; letter-spacing: 0.04em; text-transform: uppercase; }
    .status-connecting { color: #A7A7A7; border-color: #3E3E3E; }
    .status-listening  { color: #3CFA44; border-color: #3CFA44; background: rgba(60,250,68,0.08); }
    .status-error      { color: #FF453A; border-color: #FF453A; background: rgba(255,69,58,0.08); }
    .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
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
