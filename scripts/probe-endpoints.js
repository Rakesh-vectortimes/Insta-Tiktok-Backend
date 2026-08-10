const axios = require('axios');

const shortcode = process.argv[2] || 'DZFbef0KsWl';
const pageUrl = `https://www.instagram.com/reel/${shortcode}/`;

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function testPageMeta() {
  const r = await axios.get(pageUrl, {
    headers: {
      'User-Agent': CHROME_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    timeout: 20000,
    validateStatus: () => true,
  });
  const h = String(r.data);
  const ogVideo =
    h.match(/property="og:video:secure_url" content="([^"]+)"/)?.[1] ||
    h.match(/property="og:video" content="([^"]+)"/)?.[1];
  console.log('page status', r.status, 'og:video', ogVideo ? ogVideo.slice(0, 100) : 'none');
}

async function testMediaInfo() {
  const r = await axios.get(`https://www.instagram.com/api/v1/media/${shortcode}/info/`, {
    headers: {
      'User-Agent': CHROME_UA,
      'X-IG-App-ID': '936619743392459',
      Accept: '*/*',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: pageUrl,
    },
    timeout: 20000,
    validateStatus: () => true,
  });
  console.log('media/info status', r.status, 'type', typeof r.data);
  if (typeof r.data === 'object') {
    const items = r.data?.items || [];
    const v = items[0]?.video_versions?.[0]?.url;
    console.log('video', v ? v.slice(0, 100) : 'none');
  } else {
    console.log('body', String(r.data).slice(0, 200));
  }
}

async function main() {
  await testPageMeta();
  await testMediaInfo();
}

main().catch(console.error);
