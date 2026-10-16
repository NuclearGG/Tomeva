'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Diagnostics deliberately exclude messages, paths, URLs and record payloads.
// Circulation's separately protected audit log has its own retention policy.
function createStructuredLogger({ directory, component, sink }) {
  const allowed = new Set(['code', 'method', 'channel', 'state', 'mode', 'from', 'to', 'count', 'durationMs', 'dbSchemaVersion']);
  return (level, event, fields = {}) => {
    try {
      if (!['info', 'warn', 'error'].includes(level) || !/^[a-z][a-z0-9_.-]{0,79}$/.test(event)) return;
      const data = {};
      for (const [name, value] of Object.entries(fields)) {
        if (!allowed.has(name)) continue;
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) data[name] = value;
        else if (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value)) data[name] = value;
      }
      const line = JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), component, level, event, ...data });
      if (sink) { sink(line); return; }
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, 'diagnostics.jsonl');
      if (fs.existsSync(file) && fs.statSync(file).size >= 5 * 1024 * 1024) {
        for (let index = 2; index >= 0; index--) {
          const source = index ? file + '.' + index : file, target = file + '.' + (index + 1);
          if (fs.existsSync(source)) { if (fs.existsSync(target)) fs.unlinkSync(target); fs.renameSync(source, target); }
        }
      }
      fs.appendFileSync(file, line + '\n', { mode: 0o600 });
    } catch { /* A full disk or failed diagnostic sink must not alter app work. */ }
  };
}
module.exports = { createStructuredLogger };
