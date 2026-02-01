FROM python:3.11-slim

# Install networking tools and text editors
RUN apt-get update && apt-get install -y \
    iputils-ping \
    net-tools \
    curl \
    wget \
    netcat-openbsd \
    dnsutils \
    iproute2 \
    tcpdump \
    traceroute \
    nano \
    vim \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY vessel_lists/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create data directory and volume
RUN mkdir -p /app/data
VOLUME /app/data

COPY vessel_lists/ .

# Expose port (8081)
EXPOSE 8081

# Run the app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8081"]
