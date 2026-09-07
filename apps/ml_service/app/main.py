"""
Kaarigar ML microservice.

Two independent capabilities, each degrading gracefully on its own:
  - POST /price/predict  — sklearn pricing model. On boot, trains if the
    cached joblib is missing or pickled with a different scikit-learn
    version, then keeps it in memory.
  - POST /asr            — AI4Bharat-style ASR fallback tier, only available
    if the optional `transformers`/`torch` deps are installed (see
    requirements-asr.txt) AND ASR_MODEL_ID is set. Otherwise returns 503 so
    the Next.js side falls through to the browser's Web Speech API cleanly.

Deploy target: Render / a Hugging Face Space / any long-running host — NOT
Vercel, which can't run a persistent Python process. See README.md.
"""

import io
import os
import sys
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if SERVICE_DIR not in sys.path:
    sys.path.insert(0, SERVICE_DIR)

from train import DEFAULT_MODEL_PATH, load_cached_model

MODEL_PATH = DEFAULT_MODEL_PATH
ASR_MODEL_ID = os.environ.get("ASR_MODEL_ID")  # e.g. an AI4Bharat IndicWav2Vec/IndicConformer checkpoint

# Shared secret with the Next.js app (apps/web/src/infra/ml/ml-service.client.ts).
# Left unset in local dev to keep curl/Swagger testing frictionless; require it
# once this is actually deployed and reachable from the internet.
INTERNAL_API_KEY = os.environ.get("ML_SERVICE_API_KEY")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_pricing_model.cache_clear()
    get_pricing_model()
    yield


app = FastAPI(title="Kaarigar ML Service", version="1.0.0", lifespan=lifespan)


def require_internal_api_key(x_internal_api_key: Optional[str] = Header(default=None)):
    if INTERNAL_API_KEY and x_internal_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing x-internal-api-key")


@lru_cache(maxsize=1)
def get_pricing_model():
    return load_cached_model(MODEL_PATH)


@lru_cache(maxsize=1)
def get_asr_pipeline():
    if not ASR_MODEL_ID:
        raise RuntimeError(
            "ASR_MODEL_ID is not set. Point it at an AI4Bharat IndicConformer/IndicWav2Vec "
            "checkpoint (or another ASR model) on the Hugging Face Hub to enable /asr."
        )
    try:
        from transformers import pipeline
    except ImportError as e:
        raise RuntimeError(
            "transformers/torch are not installed — install requirements-asr.txt to enable /asr."
        ) from e

    return pipeline("automatic-speech-recognition", model=ASR_MODEL_ID)


class PricePredictRequest(BaseModel):
    category: str
    material: Optional[str] = None
    size_band: str = Field(default="medium", pattern="^(small|medium|large)$")
    region: Optional[str] = None
    lead_time_days: int = Field(default=14, ge=1, le=120)
    experience_years: int = Field(default=5, ge=0, le=90)


class PricePredictResponse(BaseModel):
    price: float
    min: float
    max: float
    confidence: float
    top_features: list[str]


@app.get("/health")
def health():
    pricing_ready = False
    try:
        get_pricing_model()
        pricing_ready = True
    except Exception:
        pricing_ready = False

    asr_available = False
    try:
        get_asr_pipeline()
        asr_available = True
    except Exception:
        asr_available = False
    return {"status": "ok", "pricing_model_ready": pricing_ready, "asr_available": asr_available}


@app.post("/price/predict", response_model=PricePredictResponse, dependencies=[Depends(require_internal_api_key)])
def predict_price(req: PricePredictRequest):
    try:
        bundle = get_pricing_model()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Pricing model unavailable: {e}") from e

    import pandas as pd

    row = pd.DataFrame(
        [
            {
                "category": req.category,
                "material": req.material or "unknown",
                "size_band": req.size_band,
                "region": req.region or "unknown",
                "lead_time_days": req.lead_time_days,
                "experience_years": req.experience_years,
            }
        ]
    )

    price_min = float(bundle["model_min"].predict(row)[0])
    price_max = float(bundle["model_max"].predict(row)[0])
    if price_max < price_min:
        price_min, price_max = price_max, price_min
    # A single point estimate alongside the market range — the UI shows
    # both (material cost / market range / suggested price).
    price = (price_min + price_max) / 2

    known = req.category in bundle["known_categories"]
    confidence = 0.8 if known else 0.4

    regressor = bundle["model_max"].named_steps["regressor"]
    preprocessor = bundle["model_max"].named_steps["preprocess"]
    try:
        feature_names = preprocessor.get_feature_names_out()
        importances = regressor.feature_importances_
        top_idx = importances.argsort()[::-1][:3]
        top_features = [feature_names[i].split("__")[-1] for i in top_idx]
    except Exception:
        top_features = []

    return PricePredictResponse(
        price=round(max(price, 0), 2),
        min=round(max(price_min, 0), 2),
        max=round(max(price_max, 0), 2),
        confidence=confidence,
        top_features=top_features,
    )


@app.post("/asr", dependencies=[Depends(require_internal_api_key)])
async def transcribe(file: UploadFile = File(...), language_hint: Optional[str] = None):
    try:
        asr = get_asr_pipeline()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    audio_bytes = await file.read()

    try:
        import soundfile as sf

        data, samplerate = sf.read(io.BytesIO(audio_bytes))
        result = asr({"array": data, "sampling_rate": samplerate})
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not process audio: {e}") from e

    return {"transcript": result.get("text", "").strip(), "language": language_hint or "hi"}
