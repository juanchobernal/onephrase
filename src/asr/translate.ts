// Google Cloud Translation v2 REST wrapper.
//
// Why v2 and not v3? v3 requires OAuth + project ID — v2 takes a plain
// API key, which matches what `.env.local` ships. Perfectly fine for a
// translation app: the key is restricted to the Translation API.

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2'

const cache = new Map<string, string>()

export async function translate(
  apiKey: string,
  text: string,
  target = 'es',
  source?: string,
): Promise<string> {
  if (!apiKey) throw new Error('Google API key missing — set VITE_GOOGLE_API_KEY in .env.local')
  const trimmed = text.trim()
  if (!trimmed) return ''

  // If the source language is already the target, skip the round-trip.
  if (source && source.toLowerCase().startsWith(target.toLowerCase())) return trimmed

  const cacheKey = `${target}|${source ?? 'auto'}|${trimmed}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const body: Record<string, string> = { q: trimmed, target, format: 'text' }
  if (source) body.source = source

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Translate ${res.status}: ${errText.slice(0, 200)}`)
  }

  const json = await res.json()
  const out: string = json?.data?.translations?.[0]?.translatedText ?? ''
  cache.set(cacheKey, out)
  return out
}
