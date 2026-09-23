/** Vertex AI Gemini client using Cloud Run service-account credentials (ADC). */
const https = require('https');
const { GoogleAuth } = require('google-auth-library');

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
          reject(new Error(`Vertex AI status ${response.statusCode}: ${data.slice(0, 300)}`));
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
  const token = await auth.getAccessToken();
  if (!token) throw new Error('Vertex AI application-default credentials are unavailable');
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/locations/${encodeURIComponent(LOCATION)}/publishers/google/models/${encodeURIComponent(MODEL)}:generateContent`;
  const response = await requestJson(endpoint, token, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  }, options.timeoutMs || 10000);
  return response.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
}

module.exports = { generateText, MODEL, LOCATION };
