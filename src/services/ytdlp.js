const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getCookieFile, hasCookieFile } = require('../utils/cookies');

const TEMP = path.join(__dirname, '../../temp');

const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildArgs(extraArgs = [], { sessionid } = {}) {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--user-agent', randomUA(),
    '--sleep-requests', '2',
    '--min-sleep-interval', '1',
    '--max-sleep-interval', '4',
    '--extractor-retries', '5',
    '--retry-sleep', 'exp=1:120',
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
    '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  ];

  const cookieFile = getCookieFile();

  if (hasCookieFile()) {
    args.push('--cookies', cookieFile);
    console.log('[yt-dlp] Using cookies:', path.basename(cookieFile));
  } else if (process.env.INSTAGRAM_COOKIES_BROWSER) {
    args.push('--cookies-from-browser', process.env.INSTAGRAM_COOKIES_BROWSER);
    console.log('[yt-dlp] Using browser cookies:', process.env.INSTAGRAM_COOKIES_BROWSER);
  } else {
    const resolved = sessionid || process.env.INSTAGRAM_SESSION_ID;
    if (resolved) {
      args.push('--add-header', `Cookie:sessionid=${resolved}`);
      console.log('[yt-dlp] Using sessionid from request/env');
    } else {
      console.warn('[yt-dlp] No cookies found — Instagram will likely rate-limit');
    }
  }

  return [...args, ...extraArgs];
}

function formatYtdlpError(raw = '') {
  if (/getaddrinfo failed/i.test(raw)) {
    return 'Network/DNS error: could not reach Instagram. Check your internet connection, VPN, and DNS settings.';
  }
  if (/no video formats found/i.test(raw)) {
    return 'This post contains images only. Use POST /api/instagram/post — yt-dlp cannot download photo carousels directly.';
  }
  if (/rate|429|empty media/i.test(raw)) {
    return 'Instagram rate-limited. Add cookies.txt to project root (export while logged in via browser extension).';
  }
  if (/login required|authentication|cookies/i.test(raw)) {
    return 'Instagram requires login. Add cookies.txt to project root.';
  }
  return raw.trim() || 'yt-dlp failed';
}

function hasInstagramAuth(sessionid) {
  return (
    hasCookieFile() ||
    !!process.env.INSTAGRAM_COOKIES_BROWSER ||
    !!sessionid ||
    !!process.env.INSTAGRAM_SESSION_ID
  );
}

function getInfo(url, extraArgs = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const args = [...buildArgs(extraArgs, opts), '--dump-json', url];

    const proc = spawn('yt-dlp', args);
    let out = '';
    let err = '';

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error('Failed to parse yt-dlp output'));
        }
      } else {
        reject(new Error(formatYtdlpError(err)));
      }
    });
  });
}

function downloadToFile(url, outputPath, extraArgs = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const args = [...buildArgs(extraArgs, opts), '-o', outputPath, url];

    const proc = spawn('yt-dlp', args);
    let err = '';

    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(formatYtdlpError(err)));
    });
  });
}

function streamDownload(url, res, filename, extraArgs = [], opts = {}) {
  const { contentType = 'video/mp4', sessionid } = opts;
  const args = [...buildArgs(extraArgs, { sessionid }), '-o', '-', url];

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);

  const proc = spawn('yt-dlp', args);
  proc.stdout.pipe(res);
  proc.stderr.on('data', (d) => console.error('[yt-dlp]', d.toString()));
  proc.on('close', (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(500).json({ error: 'Stream failed' });
    }
  });
}

function extractMp3(videoPath, audioPath, bitrate = '192k') {
  const ffmpeg = require('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate(bitrate)
      .output(audioPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

module.exports = {
  getInfo,
  downloadToFile,
  streamDownload,
  extractMp3,
  buildArgs,
  hasInstagramAuth,
  formatYtdlpError,
  TEMP,
};
