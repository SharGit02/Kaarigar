import { z } from "zod"

/**
 * Every third-party key is optional at the schema level. Nothing here throws
 * at import time for a missing integration — the app must still boot and
 * render UI with zero keys configured. Instead:
 *   - `features` (below) tells the rest of the app which integrations are live.
 *   - Code that genuinely cannot proceed without a given secret (e.g. the DB
 *     client) throws a clear, actionable error the moment it's actually used,
 *     not at boot.
 *
 * JWT signing secrets are the one exception: they're security-critical, so in
 * development we generate an ephemeral one with a loud warning rather than
 * silently running with a weak/shared default; in production they're required.
 */

const isProd = process.env.NODE_ENV === "production"

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),

  // --- Database (Neon Postgres) ---
  DATABASE_URL: z.string().optional(),

  // --- Auth / sessions ---
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),

  // --- OTP delivery (Renflair WhatsApp — primary + fallbacks) ---
  RENFLAIR_WHATSAPP_API_KEY: z.string().optional(),
  RENFLAIR_WHATSAPP_API_KEY_2: z.string().optional(),
  RENFLAIR_WHATSAPP_API_KEY_3: z.string().optional(),
  RENFLAIR_WHATSAPP_API_KEY_4: z.string().optional(),
  RENFLAIR_WHATSAPP_API_KEY_5: z.string().optional(),
  RENFLAIR_WHATSAPP_API_KEY_6: z.string().optional(),
  /** @deprecated use RENFLAIR_WHATSAPP_API_KEY */
  RENFLAIR_SMS_API_KEY: z.string().optional(),

  // --- OTP delivery (Twilio SMS — optional fallback) ---
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  /** @deprecated use TWILIO_ACCOUNT_SID */
  TWILIO_SID: z.string().optional(),
  /** @deprecated use TWILIO_AUTH_TOKEN */
  TWILIO_CLIENT_SECRET: z.string().optional(),

  // --- Speech-to-text (Sarvam AI primary) ---
  SARVAM_API_KEY: z.string().optional(),

  // --- Python ML microservice (AI4Bharat ASR fallback + sklearn pricing) ---
  // Deployed separately (apps/ml_service/) — ML_SERVICE_API_KEY is the shared
  // secret both sides must agree on so the ML service can reject requests
  // that didn't come from this app.
  ML_SERVICE_URL: z.string().url().optional(),
  ML_SERVICE_TIMEOUT_MS: z.coerce.number().default(8000),
  ML_SERVICE_API_KEY: z.string().optional(),

  // --- Gemini (structured extraction, pricing rationale, product copy) ---
  GEMINI_API_KEY: z.string().optional(),

  // --- Cloudinary (media storage + enhancement) ---
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // --- ElevenLabs (onboarding voice narration) ---
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),

  // --- Razorpay (advance payments) ---
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().optional(),

  // --- Pusher Channels (real-time chat delivery) — messages are always
  // persisted to Postgres; Pusher is purely the live-notify side-channel.
  // Without these, chat falls back to the existing polling transport.
  PUSHER_APP_ID: z.string().optional(),
  PUSHER_KEY: z.string().optional(),
  PUSHER_SECRET: z.string().optional(),
  PUSHER_CLUSTER: z.string().optional(),
  NEXT_PUBLIC_PUSHER_KEY: z.string().optional(),
  NEXT_PUBLIC_PUSHER_CLUSTER: z.string().optional(),

  // --- OAuth login (Google / GitHub) — additive to phone/OTP, not a
  // replacement. Redirect URIs to register with each provider:
  //   {NEXT_PUBLIC_APP_URL}/api/auth/oauth/google/callback
  //   {NEXT_PUBLIC_APP_URL}/api/auth/oauth/github/callback
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // --- Seed / bootstrap ---
  ADMIN_PHONE_NUMBERS: z.string().optional(), // comma-separated E.164
})

// An unset .env value (e.g. `JWT_ACCESS_SECRET=` — every blank key in
// .env.example) arrives here as "", not undefined. Treat blank the same as
// missing before validating, so "optional" integrations really are optional.
const envWithBlanksAsUnset = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v])
)

const parsed = schema.safeParse(envWithBlanksAsUnset)

if (!parsed.success) {
  // Only truly malformed values (not "missing") land here, since everything
  // above is optional — e.g. a JWT secret shorter than 32 chars.
  console.error("[env] Invalid environment configuration:", parsed.error.flatten().fieldErrors)
  throw new Error("Invalid environment configuration — see console output above.")
}

const raw = parsed.data

function devFallbackSecret(name: string): string {
  if (isProd) {
    throw new Error(
      `[env] ${name} is required in production. Generate one with:\n` +
      `  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
    )
  }
  // Stable per-process, not per-request — sessions just don't survive a dev restart.
  // Web Crypto (not node:crypto) so this module stays loadable from the Edge
  // Runtime (proxy.ts -> jwt.ts -> env.ts).
  const key = `__Kaarigar_dev_${name}`
  const g = globalThis as unknown as Record<string, string>
  if (!g[key]) {
    const bytes = new Uint8Array(48)
    crypto.getRandomValues(bytes)
    g[key] = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    console.warn(
      `[env] ${name} is not set — using an ephemeral development secret. ` +
      `Set it in .env.local before deploying.`
    )
  }
  return g[key]
}

export const env = {
  ...raw,
  JWT_ACCESS_SECRET: raw.JWT_ACCESS_SECRET ?? devFallbackSecret("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: raw.JWT_REFRESH_SECRET ?? devFallbackSecret("JWT_REFRESH_SECRET"),
  TWILIO_ACCOUNT_SID: (raw.TWILIO_ACCOUNT_SID ?? raw.TWILIO_SID)?.trim(),
  TWILIO_AUTH_TOKEN: (raw.TWILIO_AUTH_TOKEN ?? raw.TWILIO_CLIENT_SECRET)?.trim(),
  TWILIO_PHONE_NUMBER: raw.TWILIO_PHONE_NUMBER?.trim(),
  TWILIO_MESSAGING_SERVICE_SID: raw.TWILIO_MESSAGING_SERVICE_SID?.trim(),
  RENFLAIR_WHATSAPP_API_KEY: (raw.RENFLAIR_WHATSAPP_API_KEY ?? raw.RENFLAIR_SMS_API_KEY)?.trim(),
  RENFLAIR_WHATSAPP_API_KEY_2: raw.RENFLAIR_WHATSAPP_API_KEY_2?.trim(),
  RENFLAIR_WHATSAPP_API_KEY_3: raw.RENFLAIR_WHATSAPP_API_KEY_3?.trim(),
  RENFLAIR_WHATSAPP_API_KEY_4: raw.RENFLAIR_WHATSAPP_API_KEY_4?.trim(),
  RENFLAIR_WHATSAPP_API_KEY_5: raw.RENFLAIR_WHATSAPP_API_KEY_5?.trim(),
  RENFLAIR_WHATSAPP_API_KEY_6: raw.RENFLAIR_WHATSAPP_API_KEY_6?.trim(),
}

/** Ordered Renflair WhatsApp API keys — primary first, then fallbacks when quota is exhausted. */
export function renflairWhatsappApiKeys(): string[] {
  return [
    env.RENFLAIR_WHATSAPP_API_KEY,
    env.RENFLAIR_WHATSAPP_API_KEY_2,
    env.RENFLAIR_WHATSAPP_API_KEY_3,
    env.RENFLAIR_WHATSAPP_API_KEY_4,
    env.RENFLAIR_WHATSAPP_API_KEY_5,
    env.RENFLAIR_WHATSAPP_API_KEY_6,
  ].filter((key): key is string => Boolean(key))
}

/**
 * Derived feature flags. Every AI/payment/SMS surface in the app should read
 * from here instead of poking at `env.SOME_KEY` directly, so the "is this
 * integration live" decision is made in exactly one place.
 */
export const features = {
  database: Boolean(env.DATABASE_URL),
  smsProvider: (renflairWhatsappApiKeys().length > 0
    ? "renflair"
    : env.TWILIO_ACCOUNT_SID &&
        env.TWILIO_AUTH_TOKEN &&
        (env.TWILIO_PHONE_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID)
      ? "twilio"
      : "none") as "renflair" | "twilio" | "none",
  sarvam: Boolean(env.SARVAM_API_KEY),
  mlService: Boolean(env.ML_SERVICE_URL),
  gemini: Boolean(env.GEMINI_API_KEY),
  cloudinary: Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
  ),
  elevenlabs: Boolean(env.ELEVENLABS_API_KEY),
  razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
  pusher: Boolean(env.PUSHER_APP_ID && env.PUSHER_KEY && env.PUSHER_SECRET && env.PUSHER_CLUSTER),
  oauthGoogle: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  oauthGithub: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
} as const

export function adminPhoneNumbers(): string[] {
  return (env.ADMIN_PHONE_NUMBERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}
