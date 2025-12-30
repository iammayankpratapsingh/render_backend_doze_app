// utils/dlog.js
// Console-only debug logger (no file is created / written).
const LOG_FILE = null;

function fmt(v) {
  try { return typeof v === 'string' ? v : JSON.stringify(v); }
  catch { return String(v); }
}

function log(msg, meta) {
  const line = `[${new Date().toISOString()}] ${msg}${meta !== undefined ? ' ' + fmt(meta) : ''}\n`;
  // Keep behavior visible in dev, but do not write to disk.
  console.log('[DBG]', line.trim());
  if (meta !== undefined) console.log('[DBG_META]', meta);
}

function clear() {
  // no-op (no file to clear)
}

module.exports = Object.assign(log, { file: LOG_FILE, clear });
