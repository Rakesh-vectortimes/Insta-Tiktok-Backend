const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function getProxyUrl() {
  return process.env.IG_HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
}

function getProxyStatus() {
  const proxyUrl = process.env.IG_HTTP_PROXY || null;
  if (!proxyUrl) {
    return {
      enabled: false,
      configured: 'no',
      scope: 'instagram-metadata-only',
    };
  }

  try {
    const url = new URL(proxyUrl);
    return {
      enabled: true,
      configured: 'yes',
      scope: 'instagram-metadata-only',
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? '443' : '80'),
    };
  } catch {
    return {
      enabled: false,
      configured: 'invalid',
      scope: 'instagram-metadata-only',
    };
  }
}

function createIgAxios({ useProxy = true, ...extra } = {}) {
  const proxyUrl = useProxy ? getProxyUrl() : null;
  const config = {
    timeout: 20000,
    validateStatus: (s) => s < 500,
    ...extra,
  };

  if (proxyUrl) {
    const agent = new HttpsProxyAgent(proxyUrl);
    config.httpAgent = agent;
    config.httpsAgent = agent;
    config.proxy = false;
  }

  return axios.create(config);
}

// instagram.com / i.instagram.com metadata — routes through IG_HTTP_PROXY when set
const igAxios = createIgAxios({ useProxy: true });
// CDN (cdninstagram.com, fbcdn.net) — direct, no proxy (saves bandwidth)
const igCdnAxios = createIgAxios({ useProxy: false });

function chromeDocumentHeaders(referer) {
  return {
    'User-Agent': CHROME_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-CH-UA': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    ...(referer ? { Referer: referer } : {}),
  };
}

function chromeApiHeaders(referer) {
  return {
    'User-Agent': CHROME_UA,
    'X-IG-App-ID': '936619743392459',
    'X-ASBD-ID': '359341',
    'X-IG-WWW-Claim': '0',
    Origin: 'https://www.instagram.com',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-CH-UA': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: referer,
  };
}

function iphoneHeaders() {
  return {
    'User-Agent': IPHONE_UA,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

module.exports = {
  igAxios,
  igCdnAxios,
  createIgAxios,
  getProxyUrl,
  getProxyStatus,
  chromeDocumentHeaders,
  chromeApiHeaders,
  iphoneHeaders,
  CHROME_UA,
  IPHONE_UA,
};
