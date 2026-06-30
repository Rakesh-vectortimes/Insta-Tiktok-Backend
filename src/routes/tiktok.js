const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const { getInfo, downloadToFile, streamDownload, extractMp3, TEMP } = require('../services/ytdlp');
const {
  QUALITIES,
  FORMATS,
  parseMediaOptions,
  getVideoFormatString,
  getAudioBitrate,
  buildDownloadLinks,
} = require('../utils/mediaOptions');

// ── Video without watermark ───────────────────────────────────────────────────
router.post('/video', async (req, res) => {
  const { url, format, quality } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const media = parseMediaOptions({ format, quality });
    const info = await getInfo(url, ['--format', 'bestvideo+bestaudio/best']);
    const downloads = buildDownloadLinks('/api/tiktok/video/stream', { url });
    const selected = downloads.find(
      d => d.format === media.format && d.quality === media.quality
    );

    res.json({
      title: info.title,
      author: info.uploader,
      thumbnail: info.thumbnail,
      duration: info.duration,
      views: info.view_count,
      formats: FORMATS,
      qualities: QUALITIES.map(q => `${q}p`),
      downloadUrl: selected.url,
      downloads,
    });
  } catch (err) {
    if (/Invalid (quality|format)/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/video/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let media;
  try {
    media = parseMediaOptions(req.query);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const baseName = `tiktok_${Date.now()}_${media.quality}p`;

  if (media.format === 'mp4') {
    return streamDownload(url, res, `${baseName}.mp4`, [
      '--format', getVideoFormatString(media.quality),
    ]);
  }

  const id = uuidv4();
  const videoPath = path.join(TEMP, `${id}.mp4`);
  const audioPath = path.join(TEMP, `${id}.mp3`);

  try {
    await downloadToFile(url, videoPath, [
      '--format', getVideoFormatString(media.quality),
    ]);
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

// ── Audio extraction (MP3) ────────────────────────────────────────────────────
router.post('/audio', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const id = uuidv4();
  const videoPath = path.join(TEMP, `${id}.mp4`);
  const audioPath = path.join(TEMP, `${id}.mp3`);

  try {
    // 1. Download video to temp
    await downloadToFile(url, videoPath, ['--format', 'bestaudio/best']);

    // 2. Extract audio via FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .output(audioPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // 3. Stream MP3 to client
    const info = await getInfo(url).catch(() => ({ title: 'audio' }));
    res.setHeader('Content-Disposition', `attachment; filename="${info.title || 'audio'}.mp3"`);
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

// ── Slideshow frames extraction ───────────────────────────────────────────────
router.post('/slideshow', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const info = await getInfo(url);

    // TikTok slideshows appear as entries or images array
    const images = info.entries
      ? info.entries.map(e => e.url)
      : info.images || [info.thumbnail];

    res.json({
      type: 'slideshow',
      count: images.length,
      images,
      audio: info.url  // Background audio URL if present
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
