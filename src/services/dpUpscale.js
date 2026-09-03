const sharp = require('sharp');
const { igCdnAxios } = require('../utils/igHttp');
const { isRedisEnabled, redisGet, redisSet, memoryGet, memorySet } = require('./redis');
const { DP_TTL_MS } = require('./cache');

const UPSCALE_PREFIX = 'cache:dp-upscaled:';
const UPSCALE_THRESHOLD = parseInt(process.env.DP_UPSCALE_THRESHOLD || '320', 10);
const UPSCALE_FACTOR = parseInt(process.env.DP_UPSCALE_FACTOR || '4', 10);
const UPSCALE_JPEG_QUALITY = parseInt(process.env.DP_UPSCALE_QUALITY || '92', 10);

const memoryUpscaleCache = new Map();

let sharpLib = null;
function getSharp() {
  if (!sharpLib) {
    sharpLib = sharp;
  }
  return sharpLib;
}

function shouldUpscaleDp(dpSize, { force = false, skip = false } = {}) {
  if (skip) return false;
  if (force) return true;
  return (dpSize || 0) > 0 && (dpSize || 0) < UPSCALE_THRESHOLD;
}

async function fetchDpImageBuffer(dpUrl) {
  const response = await igCdnAxios.get(dpUrl, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      Referer: 'https://www.instagram.com/',
      Accept: 'image/*,*/*;q=0.8',
    },
    timeout: 30000,
    maxContentLength: 5 * 1024 * 1024,
    maxBodyLength: 5 * 1024 * 1024,
  });

  if (response.status !== 200) {
    throw new Error(`CDN image fetch failed with status ${response.status}`);
  }

  return Buffer.from(response.data);
}

async function upscaleImageBuffer(input) {
  const image = getSharp()(input);
  const meta = await image.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  if (!width || !height) {
    throw new Error('Could not read image dimensions for upscaling');
  }

  const upscaled = await image
    .resize(width * UPSCALE_FACTOR, height * UPSCALE_FACTOR, {
      kernel: getSharp().kernel.lanczos3,
      fit: 'fill',
    })
    .jpeg({ quality: UPSCALE_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  return {
    buffer: upscaled,
    contentType: 'image/jpeg',
    width: width * UPSCALE_FACTOR,
    height: height * UPSCALE_FACTOR,
    sourceWidth: width,
    sourceHeight: height,
    factor: UPSCALE_FACTOR,
  };
}

async function getUpscaledFromCache(username) {
  const key = `${UPSCALE_PREFIX}${username}`;

  if (isRedisEnabled()) {
    const raw = await redisGet(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.data) {
          return {
            buffer: Buffer.from(parsed.data, 'base64'),
            contentType: parsed.contentType || 'image/jpeg',
            width: parsed.width,
            height: parsed.height,
            sourceWidth: parsed.sourceWidth,
            sourceHeight: parsed.sourceHeight,
            factor: parsed.factor,
            cached: true,
          };
        }
      } catch {
        /* ignore corrupt cache */
      }
    }
  }

  const mem = memoryUpscaleCache.get(key) || memoryGet(key);
  if (!mem) return null;

  if (typeof mem === 'object' && mem.expiresAt) {
    if (Date.now() > mem.expiresAt) {
      memoryUpscaleCache.delete(key);
      return null;
    }
    return { ...mem.value, cached: true };
  }

  return null;
}

async function saveUpscaledToCache(username, payload) {
  const key = `${UPSCALE_PREFIX}${username}`;
  const serialized = JSON.stringify({
    data: payload.buffer.toString('base64'),
    contentType: payload.contentType,
    width: payload.width,
    height: payload.height,
    sourceWidth: payload.sourceWidth,
    sourceHeight: payload.sourceHeight,
    factor: payload.factor,
  });
  const ttlSeconds = Math.max(1, Math.round(DP_TTL_MS / 1000));

  if (isRedisEnabled()) {
    await redisSet(key, serialized, ttlSeconds);
  }

  const entry = {
    value: { ...payload, cached: false },
    expiresAt: Date.now() + DP_TTL_MS,
  };
  memoryUpscaleCache.set(key, entry);
  memorySet(key, serialized, DP_TTL_MS);
}

async function getUpscaledDp(username, dpUrl, dpSize) {
  const cached = await getUpscaledFromCache(username);
  if (cached) return cached;

  const original = await fetchDpImageBuffer(dpUrl);
  const upscaled = await upscaleImageBuffer(original);
  await saveUpscaledToCache(username, upscaled);
  return upscaled;
}

function enrichDpResponse(dp, username) {
  const cleanUsername = String(username || dp.username || '')
    .toLowerCase()
    .trim()
    .replace('@', '');
  const encoded = encodeURIComponent(dp.username || cleanUsername);
  const lowQuality = shouldUpscaleDp(dp.dpSize);

  return {
    ...dp,
    downloadUrl: `/api/instagram/dp/${encoded}/download`,
    ...(lowQuality && {
      lowQuality: true,
      upscaleAvailable: true,
      upscaleFactor: UPSCALE_FACTOR,
      upscaleNote:
        'Instagram only exposed a low-resolution thumbnail. Download returns a 4x upscaled version.',
      estimatedUpscaledSize: (dp.dpSize || 100) * UPSCALE_FACTOR,
    }),
  };
}

function sendImageBuffer(res, buffer, filename, contentType = 'image/jpeg') {
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('X-DP-Upscaled', 'true');
  res.end(buffer);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryUpscaleCache.entries()) {
    if (now > entry.expiresAt) memoryUpscaleCache.delete(key);
  }
}, 5 * 60 * 1000);

module.exports = {
  shouldUpscaleDp,
  getUpscaledDp,
  enrichDpResponse,
  sendImageBuffer,
  UPSCALE_THRESHOLD,
  UPSCALE_FACTOR,
};
