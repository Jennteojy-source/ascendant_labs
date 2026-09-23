const fs = require('fs');
const path = require('path');

function loadFile(filePath, env = process.env) {
  if (!fs.existsSync(filePath)) return false;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || env[key]) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return true;
}

function loadLocalEnv(env = process.env) {
  if (env.NODE_ENV === 'production') return;
  const root = path.resolve(__dirname, '../..');
  loadFile(path.join(root, '.env'), env);
  // Backwards-compatible with the existing local Firebase environment file.
  loadFile(path.join(root, 'functions/.env'), env);
}

module.exports = { loadFile, loadLocalEnv };
