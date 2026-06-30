const QUALITIES = [360, 720, 1080];
const FORMATS = ['mp4', 'mp3'];

const AUDIO_BITRATE = {
  360: '128k',
  720: '192k',
  1080: '320k',
};

function parseQuality(raw) {
  if (raw == null || raw === '') return 720;
  const n = parseInt(String(raw).replace(/p$/i, ''), 10);
  if (!QUALITIES.includes(n)) {
    throw new Error(`Invalid quality. Use one of: ${QUALITIES.map(q => `${q}p`).join(', ')}`);
  }
  return n;
}

function parseFormat(raw) {
  const format = (raw || 'mp4').toLowerCase();
  if (!FORMATS.includes(format)) {
    throw new Error(`Invalid format. Use one of: ${FORMATS.join(', ')}`);
  }
  return format;
}

function parseMediaOptions({ format, quality } = {}) {
  return {
    format: parseFormat(format),
    quality: parseQuality(quality),
  };
}

function getVideoFormatString(quality) {
  return `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best[height<=${quality}]/mp4`;
}

function getAudioBitrate(quality) {
  return AUDIO_BITRATE[quality] || '192k';
}

function buildDownloadLinks(basePath, { url, sessionid }) {
  const downloads = [];

  for (const format of FORMATS) {
    for (const quality of QUALITIES) {
      const params = new URLSearchParams({
        url,
        format,
        quality: String(quality),
      });
      if (sessionid) params.set('sessionid', sessionid);

      downloads.push({
        format,
        quality,
        label: format === 'mp4' ? `${quality}p MP4` : `${quality}p MP3`,
        url: `${basePath}?${params.toString()}`,
      });
    }
  }

  return downloads;
}

module.exports = {
  QUALITIES,
  FORMATS,
  parseMediaOptions,
  getVideoFormatString,
  getAudioBitrate,
  buildDownloadLinks,
};
