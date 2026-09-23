# Production Dockerfile for Google Cloud Run
# Ascendant Labs — Competitor Meta Ad Intelligence Platform

FROM mcr.microsoft.com/playwright:v1.63.0-noble

# Set working directory
WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source files
COPY ads/ ./ads/
COPY public/ ./public/

# Expose standard Cloud Run port
EXPOSE 8080

# Run Ascendant Labs Ad Server
CMD ["node", "ads/server.js"]
