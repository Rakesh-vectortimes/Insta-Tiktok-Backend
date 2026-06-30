const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '../..');
const COOKIE_CANDIDATES = ['cookies.txt', 'www.instagram.com_cookies.txt'];

function getCookieWritePath() {
  return process.env.COOKIE_FILE_PATH || path.join(PROJECT_ROOT, 'cookies.txt');
}

function writeCookiesFromEnv() {
  const cookieContent = process.env.COOKIES_TXT_CONTENT;
  if (!cookieContent) return false;

  try {
    const target = getCookieWritePath();
    const normalized = cookieContent.replace(/\\n/g, '\n');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, normalized, 'utf8');
    console.log(`[cookies] Wrote cookies from env to ${target}`);
    return true;
  } catch (err) {
    console.error('[cookies] Failed to write cookies from env:', err.message);
    return false;
  }
}

function resolveCookieFile() {
  if (process.env.COOKIE_FILE_PATH) {
    return process.env.COOKIE_FILE_PATH;
  }
  for (const name of COOKIE_CANDIDATES) {
    const file = path.join(PROJECT_ROOT, name);
    if (fs.existsSync(file)) return file;
  }
  return path.join(PROJECT_ROOT, 'cookies.txt');
}

function getCookieFile() {
  return resolveCookieFile();
}

function loadCookieHeader(domain = 'instagram.com') {
  const cookieFile = resolveCookieFile();
  if (!fs.existsSync(cookieFile)) return null;

  const pairs = [];
  for (const line of fs.readFileSync(cookieFile, 'utf8').split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const cookieDomain = parts[0].replace(/^\./, '');
    if (!cookieDomain.includes(domain.replace(/^\./, ''))) continue;
    pairs.push(`${parts[5]}=${parts[6].trim()}`);
  }

  return pairs.length ? pairs.join('; ') : null;
}

function hasCookieFile() {
  return fs.existsSync(resolveCookieFile());
}

module.exports = {
  getCookieFile,
  loadCookieHeader,
  hasCookieFile,
  writeCookiesFromEnv,
  getCookieWritePath,
};
