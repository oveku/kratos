FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=Europe/Oslo \
    PYTHONUNBUFFERED=1 \
    REPO_DIR=/work/kratos \
    WATCH_DIR=/watch

WORKDIR /app
COPY uploader.py /app/uploader.py

RUN mkdir -p /work && useradd -u 1001 -m kratos && chown -R kratos:kratos /work /app
USER kratos

ENTRYPOINT ["python", "/app/uploader.py"]
