# Kaarigar ML Service

Python FastAPI microservice in `apps/ml_service/` so a host like Render can
use this directory as its root, independently of `apps/web/` (Vercel). It
cannot run on Vercel (no persistent Python process). It backs two things:

1. **`POST /price/predict`** — scikit-learn Gradient Boosting regressors for
   the Dynamic Pricing Assistant. On startup the service trains if
   `models/pricing_model.joblib` is missing or was pickled with a different
   scikit-learn version, then caches that file and loads it into memory.
2. **`POST /asr`** — third-tier speech-to-text fallback (after Sarvam AI,
   before the browser Web Speech API). Optional: only live if you install
   `requirements-asr.txt` and set `ASR_MODEL_ID`.

Next.js talks to this via `ML_SERVICE_URL` (see `apps/web/.env.example`) and
falls back to the pricing rules engine, or Web Speech, when this service is
unreachable.

## Model and dataset

There is no real marketplace transaction history yet. Training synthesizes
4,000 rows (400 per craft) from the same category/material/region bands as
`apps/web/src/infra/db/seed.ts` (`price_reference`), plus noise and
experience/lead-time adjustments.

| Piece | Detail |
| --- | --- |
| Algorithm | Two `GradientBoostingRegressor` pipelines (min price, max price) |
| Features | category, material, size_band, region, lead_time_days, experience_years |
| Cache | `models/pricing_model.joblib` (gitignored; created on first start) |
| Suggested price | Midpoint of predicted min/max |

This is a prior, not market truth. The web app still chains
`ml_service → rules_engine → optional Gemini`.

To force a retrain, delete `models/pricing_model.joblib` and restart (or run
`python train.py`).

## Authentication between the two apps

`/price/predict` and `/asr` require a shared-secret header:

```
x-internal-api-key: <ML_SERVICE_API_KEY>
```

Set the same `ML_SERVICE_API_KEY` here and in `apps/web`. Leave both blank
for local dev (the check is skipped when unset). `/health` stays
unauthenticated for platform checks and reports `pricing_model_ready`.

## Local development

```powershell
cd apps/ml_service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The first start trains and writes `models/pricing_model.joblib`. You do not
need to run `train.py` yourself unless you want to regenerate the cache.

Then in `apps/web/.env.local`:

```
ML_SERVICE_URL=http://localhost:8000
```

## Enabling `/asr`

```bash
pip install -r requirements-asr.txt
export ASR_MODEL_ID=<a Hugging Face Hub checkpoint id>
```

Pick an IndicConformer/IndicWav2Vec (or similar) checkpoint, confirm it
loads with `transformers.pipeline("automatic-speech-recognition", ...)`, and
set that id. Weights are large; budget a paid instance. Until then `/health`
reports `"asr_available": false` and `/asr` returns `503`.

## Deploying

**Render:** root directory **`apps/ml_service`**, build
`pip install -r requirements.txt`, start
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
The first boot trains if the joblib is not already in the image. Set
`ML_SERVICE_API_KEY` (and `ASR_MODEL_ID` if enabling ASR).

**Docker:** `docker build -t kaarigar-ml . && docker run -p 8000:8000 -e ML_SERVICE_API_KEY=... kaarigar-ml`
— the image trains during `docker build` so containers start with a cache.

## Retraining on real data

Replace `synthesize()` in `train.py` with a query against `orders` /
`products` once there is enough history. `/price/predict`'s request/response
shape does not need to change.
