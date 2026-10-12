# Sentinel Speech: Kokoro TTS + faster-whisper ASR, CPU only.
# Model weights are NOT baked in: they download on first start into the HF_HOME volume.
#
# Stage 1 builds the virtualenv with uv (CPU-only torch from the PyTorch index keeps the
# image ~2 GB smaller than the default CUDA wheel). Stage 2 copies only the venv.

ARG PYTHON_IMAGE=python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f
FROM ${PYTHON_IMAGE} AS builder

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /build
COPY pyproject.toml README.md ./
COPY speech ./speech

# torch first, from the CPU index: pinning the index here means uv resolves the rest
# of the tree (kokoro, misaki, faster-whisper) against the already-installed CPU torch.
RUN uv venv /opt/venv --python 3.12 \
 && uv pip install --python /opt/venv/bin/python --index-url https://download.pytorch.org/whl/cpu "torch>=2.2" \
 && uv pip install --python /opt/venv/bin/python --no-deps . \
 && uv pip install --python /opt/venv/bin/python \
      fastapi "uvicorn[standard]" pydantic pydantic-settings python-multipart numpy soundfile rapidfuzz httpx \
      "kokoro>=0.9.4" "faster-whisper>=1.2" \
 && find /opt/venv -name "*.pyc" -path "*/tests/*" -delete \
 && find /opt/venv -type d -name "tests" -prune -exec rm -rf {} + 2>/dev/null || true


FROM ${PYTHON_IMAGE} AS runtime

# ffmpeg: decode browser uploads + mp3 encode; espeak-ng: misaki fallback for OOV words;
# libsndfile1: soundfile (wav); libgomp1: CTranslate2/torch OpenMP runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg espeak-ng libsndfile1 libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system speech && useradd --system --gid speech --create-home --home-dir /home/speech speech \
 && mkdir -p /var/cache/speech/hf /var/cache/speech/tts \
 && chown -R speech:speech /var/cache/speech

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/var/cache/speech/hf \
    HF_HUB_DISABLE_TELEMETRY=1 \
    SPEECH_HOST=0.0.0.0 \
    SPEECH_PORT=8100 \
    SPEECH_CACHE_DIR=/var/cache/speech \
    OMP_NUM_THREADS=4

USER speech
WORKDIR /home/speech
VOLUME ["/var/cache/speech"]
EXPOSE 8100

# Models can take minutes to download on first start; the probe only fails once the
# process stops answering at all (status "warming" is still HTTP 200).
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8100/healthz > /dev/null || exit 1

CMD ["speech-server"]
