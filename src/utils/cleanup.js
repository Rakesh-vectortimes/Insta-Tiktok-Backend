const fs = require('fs');
const path = require('path');

const TEMP = path.join(__dirname, '../../temp');
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

function cleanupTemp() {
  if (!fs.existsSync(TEMP)) return;

  const now = Date.now();
  const entries = fs.readdirSync(TEMP, { withFileTypes: true });

  entries.forEach(entry => {
    const fullPath = path.join(TEMP, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        if (entry.isDirectory()) fs.rmSync(fullPath, { recursive: true, force: true });
        else fs.unlinkSync(fullPath);
      }
    } catch (e) {
      // File already deleted — ignore
    }
  });

  console.log(`[cleanup] Temp folder swept at ${new Date().toISOString()}`);
}

module.exports = { cleanupTemp };
