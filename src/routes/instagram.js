const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const {
  getInfo,
  downloadToFile,
  streamDownload,
  extractMp3,
  TEMP,
} = require('../services/ytdlp');
const { createPublicScopeError } = require('../utils/scopeErrors');
const {
  getReel,
  getPost,
  pickVideoByQuality,
  proxyMediaStream,
  downloadToTemp,
  downloadDirect,
  isDirectMediaUrl,
  normalizePostUrl,
  getProfileDp,
} = require('../services/igScraper');
const { analyzeUrl } = require('../services/analyzeUrl');
const {
  QUALITIES,
  FORMATS,
  parseMediaOptions,
  getVideoFormatString,
  getAudioBitrate,
  buildDownloadLinks,
  buildPostDownloadLinks,
} = require('../utils/mediaOptions');

function mapSource(source) {
  if (source === 'session') return 'yt-dlp';
  return 'scraper';
}

function sendAnalyzeError(res, err, fallbackStatus = 500) {
  if (err.jobId) {
    return res.status(202).json({
      status: 'queued',
      jobId: err.jobId,
      pollUrl: err.pollUrl,
      message: err.message,
      retryable: true,
    });
  }
  res.status(err.scopeLimited ? 422 : err.retryable ? 503 : fallbackStatus).json({
    error: err.message,
    scopeLimited: err.scopeLimited || false,
    retryable: err.retryable || false,
    retryAfterSeconds: err.retryAfterSeconds,
    ...(err.reasonCode && { reasonCode: err.reasonCode }),
    ...(err.details && { details: err.details }),
  });
}

function guessContentType(url, filename = '') {
  const ref = `${filename} ${url}`.toLowerCase();
  if (ref.includes('.mp4') || ref.includes('video')) return 'video/mp4';
  if (ref.includes('.mp3')) return 'audio/mpeg';
  if (ref.includes('.png')) return 'image/png';
  if (ref.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function resolveCarouselItems(url, urls) {
  if (urls?.length) return urls;
  if (!url) return null;

  const post = await getPost(normalizePostUrl(url));
  if (post.type === 'carousel') {
    return post.items.map((item) => ({ url: item.url, ext: item.ext }));
  }
  return [{ url: post.url, ext: post.ext || (post.type === 'video' ? 'mp4' : 'jpg') }];
}

async function sendCarouselZip(items, res) {
  const sessionId = uuidv4();
  const sessionDir = path.join(TEMP, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const downloadItem = (item, filePath) => {
    if (isDirectMediaUrl(item.url)) {
      return downloadDirect(item.url, filePath);
    }
    return downloadToFile(item.url, filePath, ['--format', 'b']);
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
    filePaths.forEach((fp) => archive.file(fp, { name: path.basename(fp) }));
    archive.finalize();

    res.on('finish', () => fs.rmSync(sessionDir, { recursive: true, force: true }));
  } catch (err) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    throw err;
  }
}

// ── Reel download (stream directly) ──────────────────────────────────────────
router.post('/reel', async (req, res) => {
  const { url, format, quality } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let media;
  try {
    media = parseMediaOptions({ format, quality });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const downloads = buildDownloadLinks('/api/instagram/reel/stream', { url });
  const selected = downloads.find(
    (d) => d.format === media.format && d.quality === media.quality
  );

  try {
    const scraped = await analyzeUrl(url, { mode: 'reel' });
    if (scraped.status === 'queued') {
      return res.status(202).json(scraped);
    }
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
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let media;
  try {
    media = parseMediaOptions(req.query);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const baseName = `reel_${Date.now()}_${media.quality}p`;
  const ytdlpFormat = ['--format', getVideoFormatString(media.quality)];

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
    const err = createPublicScopeError(scrapeErr);
    return res.status(422).json({
      error: err.message,
      scopeLimited: true,
      retryable: err.retryable,
      ...(err.reasonCode && { reasonCode: err.reasonCode }),
    });
  }
});

// ── Post (single image, video, or carousel) ───────────────────────────────────
router.post('/post', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const result = await analyzeUrl(url, { mode: 'post' });
    if (result.status === 'queued') {
      return res.status(202).json(result);
    }
    const { source, ...payload } = result;
    const pageUrl = normalizePostUrl(url);
    const { downloadUrl, downloads } = buildPostDownloadLinks(pageUrl, payload);
    res.json({
      ...payload,
      source: mapSource(source),
      downloadUrl,
      downloads,
    });
  } catch (err) {
    sendAnalyzeError(res, err);
  }
});

router.get('/post/stream', async (req, res) => {
  const { url, index } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const pageUrl = normalizePostUrl(url);

  try {
    const post = await getPost(pageUrl);
    let target;

    if (index != null && index !== '') {
      const idx = parseInt(index, 10);
      if (post.type !== 'carousel' || !post.items?.[idx - 1]) {
        return res.status(400).json({ error: 'Invalid carousel slide index' });
      }
      target = post.items[idx - 1];
    } else if (post.type === 'carousel') {
      return res.status(400).json({
        error: 'Carousel post — use downloadUrl from POST /post or GET /carousel/stream',
      });
    } else {
      target = {
        url: post.url,
        ext: post.ext,
        type: post.type,
        videoVersions: post.videoVersions,
      };
    }

    if (target.type === 'video') {
      let media;
      try {
        media = parseMediaOptions(req.query);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      const baseName = `post_${Date.now()}_${media.quality}p`;
      const videoUrl =
        pickVideoByQuality(target.videoVersions, media.quality) || target.url;

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
    }

    const ext = target.ext || 'jpg';
    const filename = `post_${Date.now()}.${ext}`;
    const contentType = guessContentType(target.url, filename);
    await proxyMediaStream(target.url, res, filename, contentType);
  } catch (scrapeErr) {
    console.error('[scraper]', scrapeErr.message);
    const err = createPublicScopeError(scrapeErr);
    if (!res.headersSent) {
      res.status(422).json({
        error: err.message,
        scopeLimited: true,
        retryable: err.retryable,
        ...(err.reasonCode && { reasonCode: err.reasonCode }),
      });
    }
  }
});

router.get('/carousel/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const items = await resolveCarouselItems(url);
    if (!items?.length) {
      return res.status(400).json({ error: 'Could not resolve carousel items' });
    }
    await sendCarouselZip(items, res);
  } catch (scrapeErr) {
    console.error('[scraper]', scrapeErr.message);
    const err = createPublicScopeError(scrapeErr);
    if (!res.headersSent) {
      res.status(422).json({
        error: err.message,
        scopeLimited: true,
        retryable: err.retryable,
        ...(err.reasonCode && { reasonCode: err.reasonCode }),
      });
    }
  }
});

// Carousel ZIP download (POST body)
router.post('/carousel/zip', async (req, res) => {
  const { url, urls } = req.body;

  try {
    const items = await resolveCarouselItems(url, urls);
    if (!items?.length) {
      return res.status(400).json({ error: 'Provide url (Instagram post) or urls array' });
    }
    await sendCarouselZip(items, res);
  } catch (scrapeErr) {
    const err = createPublicScopeError(scrapeErr);
    if (!res.headersSent) {
      res.status(422).json({
        error: err.message,
        scopeLimited: true,
        retryable: err.retryable,
        ...(err.reasonCode && { reasonCode: err.reasonCode }),
      });
    }
  }
});

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
router.get('/dp/:username/download', async (req, res) => {
  const { username } = req.params;

  try {
    const profile = await getProfileDp(username);
    const filename = `${profile.username || username}_dp.jpg`;
    await proxyMediaStream(profile.dpUrl, res, filename, 'image/jpeg');
  } catch (err) {
    if (!res.headersSent) {
      const status = err.retryable ? 503 : 500;
      res.status(status).json({
        error: err.message,
        retryable: err.retryable || false,
        ...(err.reasonCode && { reasonCode: err.reasonCode }),
      });
    }
  }
});

router.get('/dp/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const profile = await getProfileDp(username);
    res.json({
      ...profile,
      downloadUrl: `/api/instagram/dp/${encodeURIComponent(profile.username || username)}/download`,
    });
  } catch (err) {
    const status = err.retryable ? 503 : 500;
    res.status(status).json({
      error: err.message,
      retryable: err.retryable || false,
      ...(err.reasonCode && { reasonCode: err.reasonCode }),
    });
  }
});

// ── Stories (not supported in public-only mode) ───────────────────────────────
router.post('/story', async (req, res) => {
  res.status(422).json({
    error: "Stories require an active Instagram login and aren't supported in public-only mode.",
    scopeLimited: true,
    retryable: false,
    reasonCode: 'stories_not_supported',
  });
});

router.get('/story/stream', async (req, res) => {
  res.status(422).json({
    error: "Stories require an active Instagram login and aren't supported in public-only mode.",
    scopeLimited: true,
    retryable: false,
    reasonCode: 'stories_not_supported',
  });
});

module.exports = router;
