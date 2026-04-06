# 1. Use a lightweight Python image
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
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copy application code
COPY . .

# 6. Static directory for generated audio
RUN mkdir -p /app/app/static && chmod -R 777 /app/app/static

# 7. Environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# 8. Expose port and run
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
