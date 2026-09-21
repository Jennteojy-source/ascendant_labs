# Production Dockerfile for Google Cloud Run
# Ascendant Labs — Competitor Meta Ad Intelligence Platform

FROM mcr.microsoft.com/playwright:v1.50.0-noble

# Set working directory
WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Ensure Playwright Chromium browser and its OS libraries are available
RUN npx playwright install chromium

# Copy application source files
COPY ads/ ./ads/
COPY public/ ./public/

# Copy functions environment if present
COPY functions/.env* ./functions/

# Expose standard Cloud Run port
EXPOSE 8080

# Run Ascendant Labs Ad Server
CMD ["node", "ads/server.js"]
