# ─── Stage 1: Build / dependency install ────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# Install dependencies in an isolated layer for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ─── Stage 2: Final lean image ───────────────────────────────────────────────
FROM python:3.12-slim

# Create a non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app

# Copy installed packages from builder stage
COPY --from=builder /install /usr/local

# Copy application source
COPY main.py         .
COPY requirements.txt .
COPY templates/      templates/
COPY static/         static/

# SQLite database will be written here; ensure the user owns it
RUN chown -R appuser:appgroup /app

USER appuser

# Expose the port Render/Koyeb will route traffic to
EXPOSE 8000

# Health check – Render uses this to verify the container is alive
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/')"

# Run with Uvicorn; workers=1 is fine for SQLite; increase for PostgreSQL
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
