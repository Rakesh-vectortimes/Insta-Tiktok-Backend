const axios = require('axios');

const shortcode = process.argv[2] || 'DZFbef0KsWl';
const embedUrl = `https://www.instagram.com/reel/${shortcode}/embed/captioned/`;
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function main() {
  const { data } = await axios.get(embedUrl, {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });
  const h = String(data);
  console.log('len', h.length, 'contextJSON', h.includes('contextJSON'));
  console.log('video_versions', /"video_versions":\[/.test(h));
  console.log('video_url count', (h.match(/"video_url"/g) || []).length);
  console.log('playback_url count', (h.match(/"playback_url"/g) || []).length);
  const idx = h.indexOf('contextJSON');
  if (idx > -1) console.log('snippet', h.slice(idx, idx + 1200));
}

main().catch(console.error);
