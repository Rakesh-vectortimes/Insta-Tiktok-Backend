const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '../..');
const COOKIE_CANDIDATES = ['cookies.txt', 'www.instagram.com_cookies.txt'];

function resolveCookieFile() {
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
  return COOKIE_CANDIDATES.some((name) => fs.existsSync(path.join(PROJECT_ROOT, name)));
}

module.exports = { getCookieFile, loadCookieHeader, hasCookieFile };
