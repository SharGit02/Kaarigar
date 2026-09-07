import "server-only"
import { env } from "@/config/env"
import type { SpeechProvider } from "@/core/business/ports"

/**
 * Fallback tier: our own Python microservice (`apps/ml_service/`), running
 * AI4Bharat IndicConformer. Only reachable when ML_SERVICE_URL is set and
 * that service is actually deployed (it can't run on Vercel) — see
 * `apps/ml_service/README.md`.
 */
export const indicServiceSpeechProvider: SpeechProvider = {
  name: "indic_service",
  async transcribe({ audio, mimeType, languageHint }) {
    const form = new FormData()
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), "audio.webm")
    if (languageHint) form.append("language_hint", languageHint)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), env.ML_SERVICE_TIMEOUT_MS)

    try {
      const res = await fetch(`${env.ML_SERVICE_URL}/asr`, {
        method: "POST",
        headers: env.ML_SERVICE_API_KEY ? { "x-internal-api-key": env.ML_SERVICE_API_KEY } : undefined,
        body: form,
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`ML service /asr failed: ${res.status} ${body}`)
      }

      const data = (await res.json()) as { transcript: string; language: string }
      return { transcript: data.transcript, language: data.language }
    } finally {
      clearTimeout(timeout)
    }
  },
}
