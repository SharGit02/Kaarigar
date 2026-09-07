<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Kaarigar Project Guidance

## Project Structure

- **`apps/web/`** - Next.js 16 app (App Router, Turbopack) - primary web application
- **`apps/ml_service/`** - Python/FastAPI ML service - separate microservice
- **`apps/mobile/`** - React Native/Expo app - mobile application

Each app is independently deployable. Commands below assume you're in `apps/web/` unless specified.

## Development Commands

```bash
cd apps/web
npm install
cp .env.example .env.local        # fill DATABASE_URL at minimum
npm run db:generate               # only after schema changes
npm run db:migrate                # applies migrations from src/infra/db/migrations/*.sql
npm run db:seed                   # seeds demo data (3 approved + 1 pending_review businesses)
npm run dev
```

## Testing & Verification

```bash
cd apps/web
npm run test                      # vitest - runs domain logic tests (no DB/network)
npm run typecheck                 # TypeScript type checking
npm run lint                      # ESLint
npm run format                    # Prettier formatting
npm run build                     # Next.js build
```

**Important**: Tests are domain-only (`src/core/**/*.test.ts`). No database or network dependencies. Run `typecheck` and `build` before committing.

## Architecture Notes

- **Business logic** lives in `src/core/` - framework-agnostic, portable to Expo
- **Infrastructure adapters** in `src/infra/` - external SDKs, database, APIs
- **UI components** in `src/components/` - React components only
- **Route handlers** in `src/app/api/` - thin API layer parsing → core → serialization
- **No Drizzle imports in core** - core calls repository functions from `infra/db/repositories/`

## OTP Flow (Primary Authentication)

- **Renflair WhatsApp** for OTP delivery (primary)
- OTP codes argon2id-hashed at rest
- Rate limits: 5 requests/hour per phone, 15 requests/hour per IP
- OTP verification window: 20 minutes (increased from 10)
- Google/GitHub OAuth optional, links to same user system

## Database Operations

- **Neon Postgres** via `@neondatabase/serverless` HTTP driver
- **Never run `db:generate` unless schema changed** - it overwrites migrations
- **Always run `db:migrate` after schema changes** - applies SQL migrations
- **Seeding**: `db:seed` creates admin users (phones from `ADMIN_PHONE_NUMBERS`)

## Environment Variables

All integrations optional - app boots with zero keys configured:
- `DATABASE_URL` - Neon Postgres connection
- `RENFLAIR_WHATSAPP_API_KEY` - Renflair WhatsApp OTP (required)
- `ML_SERVICE_URL` - Python microservice (optional, localhost:8000)
- `GOOGLE_*`, `GITHUB_*` - OAuth providers (optional)

## Internationalization

- Next-intl for English/Hindi (`/en/`, `/hi/` routes)
- Locale-prefixed URLs for SEO
- Devanagari gets separate font stack (`Noto Sans Devanagari`)

## Voice & AI Pipeline

- MediaRecorder → Sarvam AI → Python ML service → Web Speech API fallback
- Every capture logged to `voice_sessions` for audit
- Python service optional - falls back to deterministic pricing rules

## Pricing System

- Python scikit-learn Gradient Boosting (min/max) → deterministic rules engine → optional Gemini refinement
- ML service trains a synthetic dataset on first start and caches `models/pricing_model.joblib`
- Rules engine always runs if the ML service is down (zero-API fallback)
- Reference bands from seeded `price_reference` data

## Admin Access

- Admin users: phone numbers in `ADMIN_PHONE_NUMBERS` env var
- `/admin` route for business approval queue
- Admin user seeded by `db:seed`

## Deployment

- **Web app**: Vercel (root: `apps/web`)
- **ML service**: Render/Fly/Docker host (root: `apps/ml_service`)
- Set matching `ML_SERVICE_API_KEY` on both sides for inter-service auth

## Mobile App (Future)

- React Native/Expo port planned
- Business logic (`src/core/`) designed for direct porting
- Current web app is MVP; mobile references `apps/mobile/CLAUDE.md`
