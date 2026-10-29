# Extract GPX Parts - Python Flask Application
FROM python:3.13-slim

# Unprivileged runtime user; UID/GID should match the owner of the mounted data volumes
ARG APP_UID=1000
ARG APP_GID=1001
RUN groupadd -g "${APP_GID}" app && useradd -u "${APP_UID}" -g "${APP_GID}" -M -s /usr/sbin/nologin app

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY web/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . /app/

# Create necessary directories for persistent data
RUN mkdir -p /app/web/uploads /app/web/processed /app/web/metadata \
    && chown -R app:app /app/web/uploads /app/web/processed /app/web/metadata

# Set environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV PORT=8080

# Change to web directory for Flask app
WORKDIR /app/web

USER app

# Unprivileged port (map it in docker-compose, e.g. "6020:8080")
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8080\")}/health', timeout=4)"

# One worker process: job status lives in memory, threads handle concurrency
CMD ["sh", "-c", "exec gunicorn --workers 1 --threads 8 --timeout 120 --bind 0.0.0.0:${PORT} app:app"]
