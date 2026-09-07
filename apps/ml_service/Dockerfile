# Deploy target: Render, Fly.io, a Hugging Face Space (Docker SDK), or any
# host that runs a persistent process — this cannot run on Vercel.
#
# Builds the lightweight (pricing-only) image by default. To include the
# /asr fallback tier, add `-r requirements-asr.txt` below and expect a much
# larger image plus real CPU/RAM (or GPU) requirements.
FROM python:3.11-slim

WORKDIR /service

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY train.py .
COPY app ./app

# Optional image-layer cache; startup also trains if this file is missing.
RUN mkdir -p models && python train.py

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
