function normalizeUrl(url) {
  return url.split('?')[0].replace(/\/$/, '');
}

module.exports = { normalizeUrl };
