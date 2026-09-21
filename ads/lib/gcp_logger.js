/**
 * Google Cloud Platform (GCP) Structured Logger
 * Ascendant Labs / Ad Intelligence
 * 
 * Complies with GCP Cloud Logging structured JSON schema:
 * - severity: DEFAULT, DEBUG, INFO, NOTICE, WARNING, ERROR, CRITICAL
 * - httpRequest: Standard W3C/GCP HTTP request metadata with latency
 * - Automatically detects Cloud Run environment (K_SERVICE, GOOGLE_CLOUD_PROJECT)
 */

const IS_GCP = Boolean(
  process.env.K_SERVICE || 
  process.env.GOOGLE_CLOUD_PROJECT || 
  process.env.GAE_SERVICE || 
  process.env.NODE_ENV === 'production'
);

function log(severity, message, context = {}) {
  const timestamp = new Date().toISOString();

  if (IS_GCP || process.env.LOG_FORMAT === 'json') {
    const payload = {
      severity,
      message,
      timestamp,
      serviceContext: {
        service: process.env.K_SERVICE || 'ascendant-ad-intelligence',
        version: process.env.K_REVISION || 'v1',
      },
      ...context,
    };
    if (severity === 'ERROR' || severity === 'CRITICAL') {
      console.error(JSON.stringify(payload));
    } else if (severity === 'WARNING') {
      console.warn(JSON.stringify(payload));
    } else {
      console.log(JSON.stringify(payload));
    }
  } else {
    // Clean local development console output
    const icons = {
      INFO: 'ℹ️ ',
      WARNING: '⚠️ ',
      ERROR: '❌ ',
      DEBUG: '🔍 ',
    };
    const icon = icons[severity] || '• ';
    const metaStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
    console.log(`[${timestamp.slice(11, 19)}] ${icon}[${severity}] ${message}${metaStr}`);
  }
}

const logger = {
  info: (msg, ctx = {}) => log('INFO', msg, ctx),
  warn: (msg, ctx = {}) => log('WARNING', msg, ctx),
  error: (msg, ctx = {}) => log('ERROR', msg, ctx),
  debug: (msg, ctx = {}) => log('DEBUG', msg, ctx),
  
  // Log HTTP request lifecycle with GCP httpRequest schema
  logHttp: (req, statusCode, durationMs, extra = {}) => {
    const severity = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARNING' : 'INFO';
    const latencySec = (durationMs / 1000).toFixed(3) + 's';
    
    const httpRequest = {
      requestMethod: req.method,
      requestUrl: req.url,
      status: statusCode,
      latency: latencySec,
      userAgent: req.headers['user-agent'] || '',
      remoteIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      protocol: `HTTP/${req.httpVersion}`,
    };

    log(severity, `${req.method} ${req.url} -> ${statusCode} (${durationMs}ms)`, {
      httpRequest,
      ...extra,
    });
  },
};

module.exports = logger;
