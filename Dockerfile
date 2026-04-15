# Stage 1: frontend build
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build


# Stage 2: backend runtime
FROM python:3.10-slim

# espeak-ng is required for phonemizer runtime
RUN apt-get update && apt-get install -y \
    espeak-ng \
    libespeak-ng-dev \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install python dependencies first for better layer caching
COPY requirements.txt .
RUN python -m pip install --upgrade pip && \
    pip install --retries 10 --timeout 120 --prefer-binary -r requirements.txt

# Copy application source
COPY . .

# Always serve freshly built frontend assets from backend
RUN rm -rf /app/app/frontend_dist && mkdir -p /app/app/frontend_dist
COPY --from=frontend-builder /frontend/dist/ /app/app/frontend_dist/

# Static directory for generated audio
RUN mkdir -p /app/app/static && chmod -R 777 /app/app/static

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
