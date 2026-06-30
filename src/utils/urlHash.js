const crypto = require('crypto');
const { normalizeUrl } = require('./normalizeUrl');

function urlHash(url) {
  return crypto.createHash('sha256').update(normalizeUrl(url)).digest('hex');
}

function videoCacheKey(hash) {
  return `video:${hash}`;
}

function jobLockKey(hash) {
  return `lock:${hash}`;
}

module.exports = {
  normalizeUrl,
  urlHash,
  videoCacheKey,
  jobLockKey,
};
