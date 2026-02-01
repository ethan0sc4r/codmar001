# ============================================================================
# DarkFleet Server - Python
# Multi-stage Docker build
# ============================================================================

# Build stage
FROM python:3.11-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies in a virtual environment
RUN pip install --no-cache-dir -r requirements.txt

# ============================================================================
# Runtime stage
# ============================================================================

FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies and networking tools
RUN apt-get update && apt-get install -y \
    curl \
    nano \
    iputils-ping \
    net-tools \
    dnsutils \
    telnet \
    traceroute \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY src/ ./src/
COPY config/ ./config/
COPY .env.example ./.env

# Create data directory
RUN mkdir -p ./data

# Expose ports
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run server
CMD ["python", "-m", "src.main"]
