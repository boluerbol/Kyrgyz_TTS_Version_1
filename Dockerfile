# Backend runtime (frontend is prebuilt into app/frontend_dist)
FROM python:3.10-slim

# 2. Install system dependencies (espeak-ng is required for phonemizer)
RUN apt-get update && apt-get install -y \
    espeak-ng \
    libespeak-ng-dev \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# 3. Set the working directory
WORKDIR /app

# 4. Copy and install requirements first (for better caching)
COPY requirements.txt .
# Network-hardened pip install (slow networks / timeouts)
RUN python -m pip install --upgrade pip && \
    pip install --retries 10 --timeout 120 --prefer-binary -r requirements.txt
# 5. Copy application code
COPY . .

# Frontend must be built before docker build:
# - Windows: .\scripts\build_frontend.ps1
# This copies `frontend/dist` -> `app/frontend_dist`.

# 6. Static directory for generated audio
RUN mkdir -p /app/app/static && chmod -R 777 /app/app/static

# 7. Environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# 8. Expose port and run
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
