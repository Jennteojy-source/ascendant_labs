/** Vertex AI Gemini client using Cloud Run service-account credentials (ADC). */
const https = require('https');
const { GoogleAuth } = require('google-auth-library');
const logger = require('./gcp_logger');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'ascendant-labs-45812';
const LOCATION = process.env.VERTEX_AI_LOCATION || 'global';
const MODEL = process.env.VERTEX_GEMINI_MODEL || 'gemini-3.8-flash';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

function requestJson(url, token, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
        } else {
          const error = new Error(`Vertex AI status ${response.statusCode}: ${data.slice(0, 300)}`);
          error.statusCode = response.statusCode;
          reject(error);
        }
      });
    });
    request.on('timeout', () => { request.destroy(); reject(new Error('Vertex AI timeout')); });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function generateText(prompt, generationConfig = {}, options = {}) {
  const startedAt = Date.now();
  const operation = options.operation || 'unspecified';
  try {
    const token = await auth.getAccessToken();
    if (!token) throw new Error('Vertex AI application-default credentials are unavailable');
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/locations/${encodeURIComponent(LOCATION)}/publishers/google/models/${encodeURIComponent(MODEL)}:generateContent`;
    const response = await requestJson(endpoint, token, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    }, options.timeoutMs || 10000);
    const usage = response.usageMetadata || {};
    const inputTokens = Number(usage.promptTokenCount) || 0;
    const outputTokens = (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
    const cachedInputTokens = Number(usage.cachedContentTokenCount) || 0;
    // Google's published introductory global Standard rates for Gemini 3.8
    // Flash expire at the end of 2026. Other models/regions require explicit rates.
    const introductoryRate = MODEL === 'gemini-3.8-flash' && LOCATION === 'global'
      && Date.now() < Date.UTC(2027, 0, 1);
    const inputRate = Number(process.env.VERTEX_INPUT_USD_PER_MILLION_TOKENS
      ?? (introductoryRate ? 0.75 : NaN));
    const outputRate = Number(process.env.VERTEX_OUTPUT_USD_PER_MILLION_TOKENS
      ?? (introductoryRate ? 3.75 : NaN));
    const cachedRate = Number(process.env.VERTEX_CACHED_INPUT_USD_PER_MILLION_TOKENS
      ?? (introductoryRate ? 0.075 : NaN));
    const hasRates = Number.isFinite(inputRate) && Number.isFinite(outputRate)
      && (!cachedInputTokens || Number.isFinite(cachedRate));
    const estimatedCostUsd = hasRates
      ? Number((Math.max(0, inputTokens - cachedInputTokens) * inputRate / 1e6
        + cachedInputTokens * cachedRate / 1e6 + outputTokens * outputRate / 1e6).toFixed(6))
      : null;
    logger.info('Vertex generation completed', {
      operation, model: MODEL, location: LOCATION,
      inputTokens, outputTokens, cachedInputTokens,
      totalTokens: Number(usage.totalTokenCount) || inputTokens + outputTokens,
      estimatedCostUsd, pricingBasis: introductoryRate ? 'gemini-3.8-flash-global-standard-2026' : 'configured-or-unavailable',
      durationMs: Date.now() - startedAt,
    });
    return response.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  } catch (error) {
    logger.warn('Vertex generation failed', {
      operation, model: MODEL, statusCode: error.statusCode || null,
      errorType: error.name || 'Error', durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

module.exports = { generateText, MODEL, LOCATION };
