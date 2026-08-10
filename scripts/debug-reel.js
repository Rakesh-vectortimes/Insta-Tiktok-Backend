const axios = require('axios');

const EMBED_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

function extractContextJsonRaw(html) {
  const marker = '"contextJSON":"';
  const start = html.indexOf(marker);
  if (start === -1) return { raw: null, marker: 'string missing' };

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
  return { raw: raw || null, marker: 'string' };
}

async function inspect(name, url, ua = EMBED_UA) {
  const { data, status } = await axios.get(url, {
    headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml' },
    validateStatus: () => true,
    timeout: 20000,
  });
  const html = String(data);
  const ctx = extractContextJsonRaw(html);
  const nullCtx = /"contextJSON":null/.test(html);

  console.log(`\n=== ${name} ===`);
  console.log('status', status, 'len', html.length);
  console.log('contextJSON:null', nullCtx);
  console.log('contextJSON string', !!ctx.raw, ctx.raw ? `len ${ctx.raw.length}` : ctx.marker);
  console.log('video_url', html.includes('video_url'));
  console.log('.mp4', html.includes('.mp4'));
  console.log('og:video', /og:video/.test(html));

  if (ctx.raw) {
    try {
      const parsed = JSON.parse(JSON.parse(`"${ctx.raw}"`));
      const media = parsed?.gql_data?.shortcode_media;
      console.log('typename', media?.__typename);
      console.log('is_video', media?.is_video);
      console.log('video_url field', media?.video_url?.slice(0, 100) || '(none)');
      console.log('video_duration', media?.video_duration);
    } catch (e) {
      console.log('parse error', e.message);
    }
  }

  const og = html.match(/property="og:video(?::secure_url)?" content="([^"]+)"/);
  if (og) console.log('og video', og[1].slice(0, 100));

  const mp4 = html.match(/https:[^"'\s]+\.mp4[^"'\s]*/);
  if (mp4) console.log('first mp4 match', mp4[0].slice(0, 120));
}

async function main() {
  const shortcode = 'DZFbef0KsWl';
  const pageUrl = `https://www.instagram.com/reel/${shortcode}/`;

  await inspect('embed /p/', `https://www.instagram.com/p/${shortcode}/embed/captioned/`);
  await inspect('embed /reel/', `https://www.instagram.com/reel/${shortcode}/embed/captioned/`);
  await inspect('reel page mobile', pageUrl, EMBED_UA);
  await inspect('reel page desktop', pageUrl, DESKTOP_UA);

  try {
    const { scrapeInstagram, getReel } = require('../src/services/igScraper');
    const scraped = await scrapeInstagram(pageUrl);
    console.log('\nscrapeInstagram OK', scraped.type, scraped.url?.slice(0, 100));
    const reel = await getReel(pageUrl);
    console.log('getReel OK', reel.type, reel.url?.slice(0, 100));
  } catch (e) {
    console.log('\nscraper FAIL', e.message);
  }

  const { data } = await axios.get(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
    headers: { 'User-Agent': EMBED_UA, Accept: 'text/html' },
  });
  const raw = extractContextJsonRaw(String(data)).raw;
  if (raw) {
    const media = JSON.parse(JSON.parse(`"${raw}"`)).gql_data.shortcode_media;
    console.log('\nvideo-related keys:', Object.keys(media).filter((k) => /video|playback|dash|clip|media/i.test(k)));
  }
}

main().catch(console.error);
