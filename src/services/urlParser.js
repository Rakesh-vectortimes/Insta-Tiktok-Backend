const PATTERNS = {
  instagram: {
    reel:    /instagram\.com\/(?:reel|reels)\/([A-Za-z0-9_-]+)/i,
    story:   /instagram\.com\/stories\/([^/]+)\/(\d+)/i,
    post:    /instagram\.com\/p\/([A-Za-z0-9_-]+)/i,
    profile: /instagram\.com\/([A-Za-z0-9._]+)\/?(?:\?.*)?$/i,
  },
  tiktok: {
    video:   /tiktok\.com\/@[^/]+\/video\/(\d+)/i,
    short:   /vm\.tiktok\.com\/([A-Za-z0-9]+)/i,
  }
};

function parseUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); }
  catch { return null; }

  for (const [platform, types] of Object.entries(PATTERNS)) {
    for (const [type, regex] of Object.entries(types)) {
      const match = rawUrl.match(regex);
      if (match) return { platform, type, match, url };
    }
  }
  return null;
}

module.exports = { parseUrl };
