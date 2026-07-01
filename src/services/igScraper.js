const {
  igAxios,
  igCdnAxios,
  chromeDocumentHeaders,
  chromeApiHeaders,
  iphoneHeaders,
} = require('../utils/igHttp');

const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
];

// Instagram only embeds media JSON on mobile UA; desktop/Android UAs return a login SPA shell.
const EMBED_USER_AGENT = iphoneHeaders()['User-Agent'];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function igHeaders() {
  return {
    'User-Agent': randomUA(),
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-IG-App-ID': '936619743392459',
  };
}

function extractShortcode(url) {
  const match = url.match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/i);
  return match?.[1] || null;
}

function normalizePostUrl(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) return url;
  if (/instagram\.com\/(?:reel|reels)\//i.test(url)) {
    return `https://www.instagram.com/reel/${shortcode}/`;
  }
  return `https://www.instagram.com/p/${shortcode}/`;
}

function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = 0n;
  for (const char of shortcode) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid Instagram shortcode');
    id = id * 64n + BigInt(index);
  }
  return id.toString();
}

function extractLsdToken(html) {
  const match =
    html.match(/"LSD",\[\],\{"token":"([^"]+)"/) ||
    html.match(/"lsd":"([^"]+)"/);
  return match?.[1] || null;
}

function cookiesFromSetCookie(setCookie = []) {
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

function parseGraphqlProduct(product) {
  if (!product) return null;

  const carousel = parseSidecarMedia(product);
  if (carousel) {
    return {
      ...carousel,
      author: carousel.author || product.user?.username || product.owner?.username,
    };
  }

  const parsed = parseMediaNode(product);
  if (!parsed) return null;

  return {
    type: parsed.type,
    url: parsed.url,
    thumbnail: parsed.thumbnail,
    ext: parsed.ext,
    title: parsed.title,
    duration: parsed.duration,
    videoVersions: parsed.videoVersions,
    author: product.user?.username || product.owner?.username,
  };
}

function isInstagramPageUrl(url) {
  return /instagram\.com\/(?:reel|reels|p)\//i.test(url);
}

function pickVideoByQuality(versions, quality) {
  if (!versions?.length) return null;
  const sorted = [...versions].sort(
    (a, b) => (b.height || b.width || 0) - (a.height || a.width || 0)
  );
  const match = sorted.find((v) => (v.height || v.width || 0) <= quality);
  return (match || sorted[sorted.length - 1]).url;
}

function parseMediaNode(node) {
  if (!node) return null;

  const videoVersions = node.video_versions?.map((v) => ({
    url: v.url,
    width: v.width,
    height: v.height,
  }));

  const isVideo =
    node.is_video ||
    node.media_type === 2 ||
    !!node.video_url ||
    !!videoVersions?.length;

  let mediaUrl;
  if (isVideo) {
    mediaUrl =
      pickVideoByQuality(videoVersions, 1080) ||
      node.video_url ||
      videoVersions?.[0]?.url;
  } else {
    mediaUrl =
      node.display_url ||
      node.image_versions2?.candidates?.[0]?.url ||
      node.thumbnail_src;
  }

  if (!mediaUrl) return null;

  const title =
    node.caption?.text ||
    node.edge_media_to_caption?.edges?.[0]?.node?.text ||
    node.title;

  return {
    type: isVideo ? 'video' : 'image',
    url: mediaUrl,
    thumbnail:
      node.thumbnail_src ||
      node.display_url ||
      node.image_versions2?.candidates?.[0]?.url,
    ext: isVideo ? 'mp4' : 'jpg',
    title,
    duration: node.video_duration,
    videoVersions,
  };
}

function parseSidecarMedia(media) {
  if (!media) return null;

  const sidecar =
    media.edge_sidecar_to_children?.edges ||
    media.carousel_media ||
    media.children?.data;

  if (!sidecar?.length) return null;

  const items = sidecar
    .map((edge, i) => {
      const parsed = parseMediaNode(edge.node || edge);
      return parsed ? { index: i + 1, ...parsed } : null;
    })
    .filter(Boolean);

  if (!items.length) return null;

  const title =
    media.caption?.text ||
    media.edge_media_to_caption?.edges?.[0]?.node?.text;

  return {
    type: 'carousel',
    count: items.length,
    items,
    title,
    author: media.owner?.username || media.user?.username,
  };
}

function parseGraphQLMedia(data) {
  const media =
    data?.items?.[0] ||
    data?.graphql?.shortcode_media ||
    data?.data?.xdt_shortcode_media;

  if (!media) return null;

  const carousel = parseSidecarMedia(media);
  if (carousel) return carousel;

  const parsed = parseMediaNode(media);
  if (!parsed) return null;

  return {
    type: parsed.type,
    url: parsed.url,
    thumbnail: parsed.thumbnail,
    ext: parsed.ext,
    title: parsed.title,
    duration: parsed.duration,
    videoVersions: parsed.videoVersions,
    author: media.owner?.username || media.user?.username,
  };
}

async function fetchOEmbed(pageUrl) {
  try {
    const { data } = await igAxios.get(
      `https://www.instagram.com/oembed/?url=${encodeURIComponent(pageUrl)}`,
      { headers: { 'User-Agent': randomUA() }, timeout: 10000 }
    );
    return {
      title: data.title,
      thumbnail: data.thumbnail_url,
      author: data.author_name,
    };
  } catch {
    return null;
  }
}

function isVideoMediaNode(node) {
  return !!(
    node?.is_video ||
    node?.__typename === 'GraphVideo' ||
    node?.media_type === 2 ||
    node?.video_url ||
    node?.video_versions?.length ||
    node?.product_type === 'clips'
  );
}

function isValidMediaUrl(url) {
  if (!url || url.length > 2048) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/[{}[\]\\]/.test(url)) return false;
  return true;
}

function extractEscapedFieldUrl(html, field) {
  const escaped = new RegExp(`\\\\"${field}\\\\":\\\\"(https:(?:\\\\\\\\/|[^"\\\\])+)\\\\"`);
  const plain = new RegExp(`"${field}":"(https:(?:[^"\\\\]|\\\\.)+)"`);
  const match = html.match(escaped) || html.match(plain);
  if (!match?.[1]) return null;
  const url = decodeJsonString(match[1]);
  return isValidMediaUrl(url) ? url : null;
}

function decodeJsonString(value) {
  let decoded;
  try {
    decoded = JSON.parse(`"${value}"`);
  } catch {
    decoded = value
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\\\/g, '\\');
  }
  return String(decoded).replace(/\\\//g, '/');
}

function embedHeaders() {
  return {
    'User-Agent': EMBED_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function extractContextJsonRaw(html) {
  const marker = '"contextJSON":"';
  const start = html.indexOf(marker);
  if (start === -1) return null;

  let i = start + marker.length;
  let raw = '';

  while (i < html.length) {
    const ch = html[i];
    if (ch === '\\' && i + 1 < html.length) {
      raw += ch + html[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') break;
    raw += ch;
    i += 1;
  }

  return raw || null;
}

function parseEmbedContextJson(html) {
  const raw = extractContextJsonRaw(html);
  if (!raw) return null;

  try {
    const unescaped = JSON.parse(`"${raw}"`);
    const parsed = JSON.parse(unescaped);
    const media = parsed?.gql_data?.shortcode_media;
    if (!media) return null;

    const carousel = parseSidecarMedia(media);
    if (carousel) return carousel;

    const result = parseMediaNode(media);
    if (result) return result;

    if (isVideoMediaNode(media)) {
      return null;
    }

    return null;
  } catch (err) {
    console.warn('[scraper] contextJSON parse failed:', err.message);
    return null;
  }
}

function extractCdnMediaFromHtml(html) {
  const patterns = [
    /property="og:video:secure_url" content="([^"]+)"/,
    /property="og:video" content="([^"]+)"/,
    /"video_url":"((?:\\.|[^"\\])*)"/,
    /"playback_url":"((?:\\.|[^"\\])*)"/,
    /(https:\/\/[^"\\]*?cdninstagram\.com[^"\\]*?\.mp4[^"\\]*)/,
    /(https:\\\/\\\/[^"\\]*?cdninstagram\.com[^"\\]*?\.mp4[^"\\]*)/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const url = decodeJsonString(match[1]);
    if (/\.mp4/i.test(url) || pattern.source.includes('video')) {
      return url;
    }
  }
  return null;
}

async function fetchPageHtml(pageUrl) {
  const { data, status } = await igAxios.get(pageUrl, {
    headers: chromeDocumentHeaders(),
  });

  if (status !== 200) {
    throw new Error(`Page fetch returned status ${status}`);
  }

  return String(data);
}

async function fetchPageMeta(pageUrl) {
  const html = await fetchPageHtml(pageUrl);
  const videoUrl = extractCdnMediaFromHtml(html);
  const imageMatch = html.match(/property="og:image" content="([^"]+)"/);

  if (videoUrl) {
    return {
      type: 'video',
      url: videoUrl,
      ext: 'mp4',
      thumbnail: imageMatch?.[1],
    };
  }

  if (imageMatch) {
    throw new Error('Page exposes thumbnail only (video requires login)');
  }

  throw new Error('No Open Graph media found on page');
}

function parseEmbedHtmlFallback(html) {
  const videoUrl = extractEscapedFieldUrl(html, 'video_url');
  const displayUrl = extractEscapedFieldUrl(html, 'display_url');

  if (videoUrl) {
    return {
      type: 'video',
      url: videoUrl,
      ext: 'mp4',
      thumbnail: displayUrl,
    };
  }

  if (displayUrl) {
    return { type: 'image', url: displayUrl, ext: 'jpg', thumbnail: displayUrl };
  }

  return null;
}

function extractCarouselFromEmbedHtml(html) {
  const urls = new Set();
  const patterns = [
    /"display_url":"(https:(?:\\.|[^"\\])+)"/g,
    /\\"display_url\\":\\"(https:(?:\\\\\/|[^"\\])+?)\\"/g,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      const url = normalizeMediaUrl(decodeJsonString(match[1]));
      if (isValidMediaUrl(url)) urls.add(url);
      match = pattern.exec(html);
    }
  }

  const list = [...urls];
  if (list.length < 2) return null;

  return {
    type: 'carousel',
    count: list.length,
    items: list.map((url, i) => ({
      index: i + 1,
      type: 'image',
      url,
      thumbnail: url,
      ext: 'jpg',
    })),
  };
}

async function fetchEmbedHtml(shortcode) {
  const embedPaths = [
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
  ];

  let lastError = null;

  for (const embedUrl of embedPaths) {
    try {
      const { data, status } = await igAxios.get(embedUrl, {
        headers: embedHeaders(),
        timeout: 15000,
      });

      if (status !== 200) {
        lastError = new Error(`Embed returned status ${status}`);
        continue;
      }

      const html = String(data);

      const fromContext = parseEmbedContextJson(html);
      if (fromContext) return fromContext;

      const fromCarousel = extractCarouselFromEmbedHtml(html);
      if (fromCarousel) return fromCarousel;

      if (html.includes('contextJSON') && /"is_video":true|"__typename":"GraphVideo"/.test(html)) {
        lastError = new Error('Video URL not available in public embed');
      }

      const fromRegex = parseEmbedHtmlFallback(html);
      if (fromRegex) return fromRegex;

      const videoUrl = extractCdnMediaFromHtml(html);
      if (videoUrl) {
        return { type: 'video', url: videoUrl, ext: 'mp4' };
      }

      lastError = new Error('Could not parse embed HTML');
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Could not parse embed HTML');
}

async function fetchPolarisGraphql(pageUrl) {
  const shortcode = extractShortcode(pageUrl);
  if (!shortcode) throw new Error('Invalid Instagram URL');

  const mediaId = shortcodeToMediaId(shortcode);
  const pageRes = await igAxios.get(pageUrl, {
    headers: chromeDocumentHeaders(),
  });

  if (pageRes.status !== 200) {
    throw new Error(`Page fetch returned status ${pageRes.status}`);
  }

  const html = String(pageRes.data);
  const lsd = extractLsdToken(html);
  if (!lsd) throw new Error('GraphQL token not found on page');

  const cookieHeader = cookiesFromSetCookie(pageRes.headers['set-cookie']);
  const csrf = cookieHeader.match(/csrftoken=([^;]+)/)?.[1] || '';
  const gqlHeaders = {
    ...chromeApiHeaders(pageUrl),
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-FB-Friendly-Name': 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
    'X-CSRFToken': csrf,
    'X-FB-LSD': lsd,
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };

  const queries = [
    {
      variables: { media_id: mediaId },
      doc_id: '27130156389949648',
    },
    {
      variables: { shortcode },
      doc_id: '8845758582119845',
    },
  ];

  let lastError = new Error('GraphQL returned no media URL');

  for (const query of queries) {
    const body = new URLSearchParams({
      av: '0',
      __d: 'www',
      __user: '0',
      dpr: '1',
      lsd,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
      server_timestamps: 'true',
      variables: JSON.stringify(query.variables),
      doc_id: query.doc_id,
    });

    const gqlRes = await igAxios.post('https://www.instagram.com/api/graphql', body.toString(), {
      headers: gqlHeaders,
    });

    if (gqlRes.status !== 200 || typeof gqlRes.data !== 'object') {
      lastError = new Error('GraphQL request blocked');
      continue;
    }

    const product =
      gqlRes.data?.data?.xig_polaris_media?.if_not_gated_logged_out ||
      gqlRes.data?.data?.xdt_shortcode_media ||
      gqlRes.data?.data?.shortcode_media;

    const media = parseGraphqlProduct(product);
    if (media) return media;
    lastError = new Error('GraphQL returned no media URL');
  }

  throw lastError;
}

async function fetchPublicYtdlp(pageUrl) {
  const { getInfo } = require('./ytdlp');
  const info = await getInfo(pageUrl, ['--format', 'b']);

  if (info.entries?.length) {
    const items = info.entries
      .map((entry, i) => {
        if (!entry.url) return null;
        return {
          index: i + 1,
          type: entry.ext === 'mp4' ? 'video' : 'image',
          url: entry.url,
          thumbnail: entry.thumbnail,
          ext: entry.ext || 'jpg',
        };
      })
      .filter(Boolean);

    if (!items.length) throw new Error('yt-dlp returned no media URL');

    if (items.length === 1) {
      return {
        type: items[0].type,
        url: items[0].url,
        thumbnail: items[0].thumbnail,
        ext: items[0].ext,
        title: info.title,
      };
    }

    return { type: 'carousel', count: items.length, items, title: info.title };
  }

  if (!info.url) throw new Error('yt-dlp returned no media URL');

  return {
    type: info.ext === 'mp4' ? 'video' : 'image',
    url: info.url,
    thumbnail: info.thumbnail,
    ext: info.ext || 'mp4',
    title: info.title,
    duration: info.duration,
  };
}

async function scrapeInstagram(pageUrl) {
  const normalized = normalizePostUrl(pageUrl);
  const shortcode = extractShortcode(normalized);
  if (!shortcode) throw new Error('Invalid Instagram URL');

  let media = null;
  const errors = [];

  const tryStep = async (label, fn) => {
    if (media) return;
    try {
      media = await fn();
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
    }
  };

  await tryStep('embed', () => fetchEmbedHtml(shortcode));
  await tryStep('page', () => fetchPageMeta(normalized));
  await tryStep('graphql', () => fetchPolarisGraphql(normalized));
  await tryStep('ytdlp', () => fetchPublicYtdlp(normalized));

  if (!media) {
    throw new Error(`Could not fetch post (${errors.join('; ')})`);
  }

  const oembed = await fetchOEmbed(normalized);
  if (oembed) {
    media.title = media.title || oembed.title;
    media.thumbnail = media.thumbnail || oembed.thumbnail;
    media.author = media.author || oembed.author;
  }

  media.source = 'scraper';
  media.pageUrl = normalized;
  media.shortcode = shortcode;
  return media;
}

async function getReel(pageUrl) {
  const media = await scrapeInstagram(pageUrl);

  if (media.type === 'carousel') {
    const video = media.items.find((item) => item.type === 'video');
    if (!video) throw new Error('No video found in carousel');
    return {
      ...video,
      pageUrl: media.pageUrl,
      source: 'scraper',
      shortcode: media.shortcode,
    };
  }

  if (media.type !== 'video') {
    throw new Error('URL is not a video reel');
  }

  return media;
}

async function getPost(pageUrl) {
  return scrapeInstagram(pageUrl);
}

function sniffMediaType(buf) {
  if (!buf?.length || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mpeg';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (buf[0] === 0x7b || buf[0] === 0x3c) return 'text/error';
  return null;
}

function assertBufferMatchesContentType(buf, contentType) {
  const sniffed = sniffMediaType(buf);
  if (!sniffed || sniffed === 'text/error') {
    const err = new Error(
      'CDN returned invalid media. The download may be blocked or the post is a photo—use /carousel/slide for images.'
    );
    err.statusCode = 422;
    throw err;
  }

  if (contentType.startsWith('video/') && sniffed !== 'video/mp4') {
    const err = new Error(
      'This post is not a video. For photo posts use GET /api/instagram/carousel/slide or /post/stream without format=mp4.'
    );
    err.statusCode = 400;
    throw err;
  }

  if (contentType.startsWith('audio/') && sniffed !== 'audio/mpeg') {
    const err = new Error('Audio extraction failed — downloaded file is not a valid MP3.');
    err.statusCode = 422;
    throw err;
  }

  if (contentType.startsWith('image/') && !sniffed.startsWith('image/')) {
    const err = new Error('Expected an image file but received a different media type.');
    err.statusCode = 422;
    throw err;
  }

  return sniffed;
}

async function proxyMediaStream(mediaUrl, res, filename, contentType = 'video/mp4') {
  const url = normalizeMediaUrl(mediaUrl);

  try {
    const response = await igCdnAxios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': randomUA(),
        Referer: 'https://www.instagram.com/',
        Accept: '*/*',
      },
      timeout: 120000,
      maxContentLength: 100 * 1024 * 1024,
      maxBodyLength: 100 * 1024 * 1024,
    });

    if (response.status !== 200) {
      const err = new Error(`CDN request failed with status ${response.status}`);
      err.retryable = response.status === 403 || response.status === 429;
      err.reasonCode = 'rate_limited';
      err.statusCode = err.retryable ? 503 : 422;
      throw err;
    }

    const buf = Buffer.from(response.data);
    const sniffed = assertBufferMatchesContentType(buf, contentType);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', sniffed);
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (err) {
    if (err.response?.status === 403 || err.response?.status === 429) {
      const blocked = new Error(
        'Instagram CDN blocked this download. Retry later — CDN requests are not proxied to save bandwidth.'
      );
      blocked.retryable = true;
      blocked.reasonCode = 'rate_limited';
      blocked.statusCode = 503;
      throw blocked;
    }
    throw err;
  }
}

function isDirectMediaUrl(url) {
  return /cdninstagram\.com|fbcdn\.net/i.test(url);
}

async function downloadDirect(url, outputPath) {
  const mediaUrl = normalizeMediaUrl(url);
  const response = await igCdnAxios.get(mediaUrl, {
    responseType: 'stream',
    headers: {
      'User-Agent': randomUA(),
      Referer: 'https://www.instagram.com/',
    },
    timeout: 120000,
  });

  if (response.status !== 200) {
    throw new Error(`CDN download failed with status ${response.status}`);
  }

  const fs = require('fs');
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  return outputPath;
}

function isHtmlWall(data) {
  return typeof data === 'string' && /<!DOCTYPE html|<html/i.test(data.slice(0, 300));
}

function decodeJsonEscapes(value) {
  return String(value)
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

function normalizeMediaUrl(url) {
  if (!url) return url;
  return decodeJsonEscapes(url);
}

function profilePicSizeFromUrl(url) {
  if (!url) return 0;
  const sized = url.match(/s(\d+)x\1(?:_tt\d+)?/i);
  if (sized) return parseInt(sized[1], 10);
  const generic = url.match(/s(\d+)x(\d+)/i);
  if (generic) return Math.min(parseInt(generic[1], 10), parseInt(generic[2], 10));
  return 0;
}

function pickBestProfilePicUrl(...urls) {
  let best = null;
  let bestSize = 0;

  for (const raw of urls) {
    const url = normalizeMediaUrl(raw);
    if (!isValidMediaUrl(url)) continue;
    const size = profilePicSizeFromUrl(url);
    if (size > bestSize) {
      bestSize = size;
      best = url;
    }
  }

  return best;
}

function extractPageTokens(html) {
  const lsd =
    html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ||
    html.match(/"lsd":"([^"]+)"/)?.[1] ||
    html.match(/name="lsd" value="([^"]+)"/)?.[1];
  const csrf = html.match(/"csrf_token":"([^"]+)"/)?.[1];
  return { lsd, csrf };
}

function findDeep(obj, key, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;

  const value = obj[key];
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDeep(item, key, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const k of Object.keys(obj)) {
    const found = findDeep(obj[k], key, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractProfilePicFromJsonScripts(html) {
  const urls = [];

  for (const match of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const json = JSON.parse(match[1]);
      const hd = findDeep(json, 'profile_pic_url_hd');
      const std = findDeep(json, 'profile_pic_url');
      if (hd) urls.push(hd);
      if (std) urls.push(std);
    } catch {
      // skip malformed script blocks
    }
  }

  return pickBestProfilePicUrl(...urls);
}

function extractBestProfilePicFromHtml(html) {
  const candidates = [];

  const fromScripts = extractProfilePicFromJsonScripts(html);
  if (fromScripts) candidates.push(fromScripts);

  for (const match of html.matchAll(/"profile_pic_url_hd":"((?:\\.|[^"\\])*)"/g)) {
    candidates.push(match[1]);
  }
  for (const match of html.matchAll(/"profile_pic_url":"((?:\\.|[^"\\])*)"/g)) {
    candidates.push(match[1]);
  }
  for (const match of html.matchAll(/\\"profile_pic_url_hd\\":\\"(https:(?:\\\\\/|[^"\\])+)\\"/g)) {
    candidates.push(match[1]);
  }
  for (const match of html.matchAll(/\\"profile_pic_url\\":\\"(https:(?:\\\\\/|[^"\\])+)\\"/g)) {
    candidates.push(match[1]);
  }
  for (const match of html.matchAll(/profile_pic_url_hd\\":\\"(https:[^\\]+)/g)) {
    candidates.push(match[1]);
  }
  for (const match of html.matchAll(/profile_pic_url\\":\\"(https:[^\\]+)/g)) {
    candidates.push(match[1]);
  }

  const ogImage = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  if (ogImage) candidates.push(ogImage);

  const best = pickBestProfilePicUrl(...candidates.map(decodeJsonEscapes));
  const size = profilePicSizeFromUrl(best);
  if (!best || size < 100) return null;
  return best;
}

function mapApiUserToProfile(user, fallbackUsername) {
  if (!user) return null;

  const dpUrl = pickBestProfilePicUrl(user.profile_pic_url_hd, user.profile_pic_url);
  if (!dpUrl) return null;

  return {
    username: user.username || fallbackUsername,
    fullName: user.full_name || null,
    dpUrl,
    dpSize: profilePicSizeFromUrl(dpUrl) || undefined,
    isPrivate: user.is_private,
    followers: user.edge_followed_by?.count,
  };
}

async function fetchProfilePage(username) {
  const profileUrl = `https://www.instagram.com/${username}/`;
  const { data, status } = await igAxios.get(profileUrl, {
    headers: iphoneHeaders(),
  });

  if (status === 429 || status === 403) {
    const err = new Error('Instagram rate-limited profile page. Try again shortly.');
    err.retryable = true;
    err.reasonCode = 'rate_limited';
    throw err;
  }
  if (status !== 200) {
    throw new Error(`Profile page returned status ${status}`);
  }

  const html = String(data);
  return {
    html,
    tokens: extractPageTokens(html),
    userId: html.match(/"user_id":"(\d+)"/)?.[1] || null,
    profileUrl,
  };
}

function buildProfileApiHeaders(profileUrl, tokens = {}) {
  const headers = { ...chromeApiHeaders(profileUrl) };
  if (tokens.lsd) {
    headers['X-FB-LSD'] = tokens.lsd;
    headers['X-CSRFToken'] = tokens.csrf || tokens.lsd;
  }
  if (tokens.csrf) {
    headers.Cookie = `csrftoken=${tokens.csrf};`;
  }
  return headers;
}

async function fetchProfileViaApi(username, pageContext = null) {
  const profileUrl = pageContext?.profileUrl || `https://www.instagram.com/${username}/`;
  const headers = buildProfileApiHeaders(profileUrl, pageContext?.tokens);

  const { data, status } = await igAxios.get(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
    { headers }
  );

  if (isHtmlWall(data)) {
    throw new Error('Instagram API blocked');
  }
  if (status === 429 || status === 403) {
    const err = new Error('Instagram rate-limited profile lookup. Try again shortly.');
    err.retryable = true;
    err.reasonCode = 'rate_limited';
    throw err;
  }
  if (status !== 200) {
    throw new Error(`Profile API returned status ${status}`);
  }

  const profile = mapApiUserToProfile(data?.data?.user, username);
  if (!profile) throw new Error('User not found');
  return { ...profile, source: 'api' };
}

async function fetchProfileViaApiWithPageTokens(username) {
  const page = await fetchProfilePage(username);
  return fetchProfileViaApi(username, page);
}

async function fetchProfileViaMobileApi(username) {
  const profileUrl = `https://www.instagram.com/${username}/`;
  const { data, status } = await igAxios.get(
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
    {
      headers: {
        'User-Agent':
          'Instagram 269.0.0.18.75 Android (26/8.0.0; 420dpi; 1080x1920; samsung; SM-G935F; hero2lte; samsungexynos8890; en_US; 314665256)',
        'X-IG-App-ID': '936619743392459',
        Accept: 'application/json',
        Referer: profileUrl,
      },
    }
  );

  if (isHtmlWall(data)) {
    throw new Error('Instagram mobile API blocked');
  }
  if (status === 429 || status === 403) {
    const err = new Error('Instagram rate-limited profile lookup. Try again shortly.');
    err.retryable = true;
    err.reasonCode = 'rate_limited';
    throw err;
  }
  if (status !== 200) {
    throw new Error(`Mobile profile API returned status ${status}`);
  }

  const profile = mapApiUserToProfile(data?.data?.user, username);
  if (!profile) throw new Error('User not found');
  return { ...profile, source: 'api' };
}

function parseProfileFromHtml(html) {
  const dpUrl = extractBestProfilePicFromHtml(html);
  if (!dpUrl) return null;

  const fullName =
    html.match(/"full_name":"((?:\\.|[^"\\])*)"/)?.[1] ||
    html.match(/property="og:title" content="([^"]+)"/)?.[1];
  const username = html.match(/"username":"([^"]+)"/)?.[1];
  const followers = html.match(/"edge_followed_by":\{"count":(\d+)/)?.[1];

  return {
    username: username || null,
    fullName: fullName ? decodeJsonEscapes(fullName) : null,
    dpUrl: normalizeMediaUrl(dpUrl),
    dpSize: profilePicSizeFromUrl(dpUrl) || undefined,
    isPrivate: /"is_private":true/.test(html),
    followers: followers ? parseInt(followers, 10) : undefined,
  };
}

async function fetchProfileViaPage(username) {
  const page = await fetchProfilePage(username);
  const parsed = parseProfileFromHtml(page.html);
  if (!parsed?.dpUrl) {
    throw new Error('Profile picture not found in page HTML');
  }

  return {
    ...parsed,
    username: parsed.username || username,
    source: 'page_scrape',
  };
}

async function fetchProfileViaOEmbed(username) {
  const profileUrl = `https://www.instagram.com/${username}/`;
  const { data, status } = await igAxios.get(
    `https://www.instagram.com/oembed/?url=${encodeURIComponent(profileUrl)}`,
    { headers: iphoneHeaders(), timeout: 10000 }
  );

  if (status === 429 || status === 403) {
    const err = new Error('Instagram rate-limited oEmbed. Try again shortly.');
    err.retryable = true;
    err.reasonCode = 'rate_limited';
    throw err;
  }
  if (status !== 200 || !data?.thumbnail_url) {
    throw new Error('oEmbed returned no profile thumbnail');
  }

  const dpUrl = normalizeMediaUrl(data.thumbnail_url);
  return {
    username,
    fullName: data.author_name || null,
    dpUrl,
    dpSize: profilePicSizeFromUrl(dpUrl) || undefined,
    source: 'oembed',
  };
}

async function getProfileDp(username) {
  const clean = String(username || '').replace(/^@/, '').trim();
  if (!clean) throw new Error('Username required');

  const errors = [];
  const results = [];

  for (const fetcher of [
    fetchProfileViaPage,
    fetchProfileViaOEmbed,
    fetchProfileViaApiWithPageTokens,
    fetchProfileViaApi,
  ]) {
    try {
      const profile = await fetcher(clean);
      const normalized = {
        ...profile,
        dpUrl: normalizeMediaUrl(profile.dpUrl),
        dpSize: profile.dpSize || profilePicSizeFromUrl(profile.dpUrl) || undefined,
        fullName: profile.fullName ? decodeJsonEscapes(profile.fullName) : profile.fullName,
      };
      results.push(normalized);
      if ((normalized.dpSize || 0) >= 320) break;
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (results.length > 0) {
    return results.reduce((best, current) =>
      (current.dpSize || 0) > (best.dpSize || 0) ? current : best
    );
  }

  const rateLimited = errors.some((msg) => /rate-limited|429|blocked/i.test(msg));
  const err = new Error(`Could not fetch profile (${errors.join('; ')})`);
  err.retryable = rateLimited;
  err.reasonCode = rateLimited ? 'rate_limited' : undefined;
  throw err;
}

module.exports = {
  scrapeInstagram,
  getReel,
  getPost,
  getProfileDp,
  pickVideoByQuality,
  proxyMediaStream,
  downloadToTemp: downloadDirect,
  downloadDirect,
  isDirectMediaUrl,
  normalizePostUrl,
  isInstagramPageUrl,
  assertBufferMatchesContentType,
};
