# DarkFleet Collettore - Multi-stage Docker build
# ================================================

# Stage 1: Base image with Python
FROM python:3.11-slim as base

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Stage 2: Production image
FROM python:3.11-slim

WORKDIR /app

# Install runtime tools (networking and editor)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    nano \
    iputils-ping \
    net-tools \
    dnsutils \
    telnet \
    traceroute \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from base
COPY --from=base /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=base /usr/local/bin /usr/local/bin

# Copy application code
COPY src/ ./src/
COPY config/ ./config/

# Create data directory
RUN mkdir -p ./data

# Set Python path
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Expose WebSocket port
EXPOSE 8090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8090/health')" || exit 1

# Run application
CMD ["python", "-m", "src.main"]
