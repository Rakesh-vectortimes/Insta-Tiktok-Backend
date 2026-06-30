const express = require('express');
const router = express.Router();
const axios = require('axios');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const {
  getInfo,
  downloadToFile,
  streamDownload,
  extractMp3,
  hasInstagramAuth,
  TEMP,
} = require('../services/ytdlp');
const { loadCookieHeader } = require('../utils/cookies');
const {
  getReel,
  getPost,
  pickVideoByQuality,
  proxyMediaStream,
  downloadToTemp,
  downloadDirect,
  isDirectMediaUrl,
  normalizePostUrl,
} = require('../services/igScraper');
const { analyzeUrl } = require('../services/analyzeUrl');
const {
  QUALITIES,
  FORMATS,
  parseMediaOptions,
  getVideoFormatString,
  getAudioBitrate,
  buildDownloadLinks,
} = require('../utils/mediaOptions');

function mapSource(source) {
  if (source === 'session') return 'yt-dlp';
  return 'scraper';
}

function sendAnalyzeError(res, err, fallbackStatus = 500) {
  res.status(err.retryable ? 503 : fallbackStatus).json({
    error: err.message,
    retryable: err.retryable || false,
    retryAfterSeconds: err.retryAfterSeconds,
    ...(err.details && { details: err.details }),
  });
}

// ── Reel download (stream directly) ──────────────────────────────────────────
router.post('/reel', async (req, res) => {
  const { url, sessionid, format, quality } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let media;
  try {
    media = parseMediaOptions({ format, quality });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const downloads = buildDownloadLinks('/api/instagram/reel/stream', { url, sessionid });
  const selected = downloads.find(
    (d) => d.format === media.format && d.quality === media.quality
  );

  try {
    const scraped = await analyzeUrl(url, { mode: 'reel', sessionid });
    return res.json({
      title: scraped.title || 'reel',
      thumbnail: scraped.thumbnail,
      duration: scraped.duration,
      author: scraped.author,
      source: mapSource(scraped.source),
      formats: FORMATS,
      qualities: QUALITIES.map((q) => `${q}p`),
      downloadUrl: selected.url,
      downloads,
    });
  } catch (err) {
    sendAnalyzeError(res, err);
  }
});

router.get('/reel/stream', async (req, res) => {
  const { url, sessionid } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let media;
  try {
    media = parseMediaOptions(req.query);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const baseName = `reel_${Date.now()}_${media.quality}p`;
  const ytdlpFormat = ['--format', getVideoFormatString(media.quality)];
  const ytdlpOpts = { sessionid };

  // Try GraphQL scraper first (no rate limit)
  try {
    const scraped = await getReel(url);
    const videoUrl =
      pickVideoByQuality(scraped.videoVersions, media.quality) || scraped.url;

    if (media.format === 'mp4') {
      return proxyMediaStream(videoUrl, res, `${baseName}.mp4`, 'video/mp4');
    }

    const id = uuidv4();
    const videoPath = path.join(TEMP, `${id}.mp4`);
    const audioPath = path.join(TEMP, `${id}.mp3`);

    await downloadToTemp(videoUrl, videoPath);
    await extractMp3(videoPath, audioPath, getAudioBitrate(media.quality));

    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    const stream = fs.createReadStream(audioPath);
    stream.pipe(res);
    stream.on('close', () => {
      fs.unlink(videoPath, () => {});
      fs.unlink(audioPath, () => {});
    });
    return;
  } catch (scrapeErr) {
    console.error('[scraper]', scrapeErr.message);
  }

  // Fallback to yt-dlp
  if (media.format === 'mp4') {
    return streamDownload(url, res, `${baseName}.mp4`, ytdlpFormat, ytdlpOpts);
  }

  const id = uuidv4();
  const videoPath = path.join(TEMP, `${id}.mp4`);
  const audioPath = path.join(TEMP, `${id}.mp3`);

  try {
    await downloadToFile(url, videoPath, ytdlpFormat, ytdlpOpts);
    await extractMp3(videoPath, audioPath, getAudioBitrate(media.quality));

    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    const stream = fs.createReadStream(audioPath);
    stream.pipe(res);
    stream.on('close', () => {
      fs.unlink(videoPath, () => {});
      fs.unlink(audioPath, () => {});
    });
  } catch (err) {
    fs.unlink(videoPath, () => {});
    fs.unlink(audioPath, () => {});
    res.status(500).json({ error: err.message });
  }
});

// ── Post (single image, video, or carousel) ───────────────────────────────────
router.post('/post', async (req, res) => {
  const { url, sessionid } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const result = await analyzeUrl(url, { mode: 'post', sessionid });
    const { source, ...payload } = result;
    res.json({ ...payload, source: mapSource(source) });
  } catch (err) {
    sendAnalyzeError(res, err);
  }
});

// Carousel ZIP download
router.post('/carousel/zip', async (req, res) => {
  const { url, urls, sessionid } = req.body;
  let items = urls;

  if ((!items || !items.length) && url) {
    try {
      const post = await getPost(normalizePostUrl(url));
      if (post.type === 'carousel') {
        items = post.items.map((item) => ({ url: item.url, ext: item.ext }));
      } else {
        items = [{ url: post.url, ext: post.ext || (post.type === 'video' ? 'mp4' : 'jpg') }];
      }
    } catch (scrapeErr) {
      console.error('[scraper]', scrapeErr.message);
      try {
        const info = await getInfo(normalizePostUrl(url), ['--format', 'b'], { sessionid });
        if (info.entries?.length) {
          items = info.entries.map((e) => ({ url: e.url, ext: e.ext || 'jpg' }));
        } else if (info.url) {
          items = [{ url: info.url, ext: info.ext || 'jpg' }];
        }
      } catch (ytErr) {
        return res.status(500).json({ error: ytErr.message });
      }
    }
  }

  if (!items || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Provide url (Instagram post) or urls array' });
  }

  const sessionId = uuidv4();
  const sessionDir = path.join(TEMP, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const downloadItem = (item, filePath) => {
    if (isDirectMediaUrl(item.url)) {
      return downloadDirect(item.url, filePath);
    }
    return downloadToFile(item.url, filePath, ['--format', 'b'], { sessionid });
  };

  try {
    const filePaths = await Promise.all(
      items.map((item, i) => {
        const filename = `item_${i + 1}.${item.ext || 'jpg'}`;
        return downloadItem(item, path.join(sessionDir, filename));
      })
    );

    res.setHeader('Content-Disposition', 'attachment; filename="carousel.zip"');
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    filePaths.forEach((fp, i) => archive.file(fp, { name: path.basename(fp) }));
    archive.finalize();

    // Cleanup after ZIP is sent
    res.on('finish', () => fs.rmSync(sessionDir, { recursive: true, force: true }));
  } catch (err) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    res.status(500).json({ error: err.message });
  }
});

function guessContentType(url, filename = '') {
  const ref = `${filename} ${url}`.toLowerCase();
  if (ref.includes('.mp4') || ref.includes('video')) return 'video/mp4';
  if (ref.includes('.mp3')) return 'audio/mpeg';
  if (ref.includes('.png')) return 'image/png';
  if (ref.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

// Proxy CDN media with Content-Disposition: attachment (forces browser download)
router.get('/download', async (req, res) => {
  const { url, filename } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const name = filename || 'download.jpg';
    const contentType = guessContentType(url, name);
    await proxyMediaStream(url, res, name, contentType);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// ── Profile picture (DP) ──────────────────────────────────────────────────────
router.get('/dp/:username', async (req, res) => {
  const { username } = req.params;

  try {
    // Fetch profile page and extract profile_pic_url_hd
    const { data } = await axios.get(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
          'x-ig-app-id': '936619743392459',
          ...(loadCookieHeader() ? { Cookie: loadCookieHeader() } : {}),
        }
      }
    );
    const user = data?.data?.user;
    if (!user) throw new Error('User not found');

    res.json({
      username: user.username,
      fullName: user.full_name,
      dpUrl: user.profile_pic_url_hd,
      isPrivate: user.is_private,
      followers: user.edge_followed_by?.count
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch profile. Instagram may require login.' });
  }
});

// ── Stories (requires session cookie) ─────────────────────────────────────────
router.post('/story', async (req, res) => {
  const { url, sessionid } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  if (!hasInstagramAuth(sessionid)) {
    return res.status(401).json({
      error: 'Instagram auth required. Pass sessionid, set INSTAGRAM_COOKIES_BROWSER, INSTAGRAM_SESSION_ID, or add cookies.txt.',
    });
  }

  try {
    const info = await getInfo(url, [], { sessionid });
    const streamQuery = new URLSearchParams({ url });
    const resolvedSession = sessionid || process.env.INSTAGRAM_SESSION_ID;
    if (resolvedSession) streamQuery.set('sessionid', resolvedSession);

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      downloadUrl: `/api/instagram/story/stream?${streamQuery.toString()}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/story/stream', async (req, res) => {
  const { url, sessionid } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const baseName = `story_${Date.now()}.mp4`;
  return streamDownload(url, res, baseName, [], { sessionid });
});

module.exports = router;
