const axios = require('axios');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';
const shortcode = 'DZFbef0KsWl';
const pageUrl = `https://www.instagram.com/reel/${shortcode}/`;

function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = 0n;
  for (const char of shortcode) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid shortcode');
    id = id * 64n + BigInt(index);
  }
  return id.toString();
}

function extractLsdToken(html) {
  const m =
    html.match(/"LSD",\[\],\{"token":"([^"]+)"/) ||
    html.match(/"lsd":"([^"]+)"/);
  return m?.[1] || null;
}

function findVideoUrl(obj, depth = 0) {
  if (!obj || depth > 8) return null;
  if (typeof obj === 'string' && /^https?:\/\/.+\.mp4/.test(obj)) return obj;
  if (typeof obj !== 'object') return null;
  if (obj.video_url) return obj.video_url;
  if (obj.video_versions?.[0]?.url) return obj.video_versions[0].url;
  for (const v of Object.values(obj)) {
    const found = findVideoUrl(v, depth + 1);
    if (found) return found;
  }
  return null;
}

async function main() {
  const mediaId = shortcodeToMediaId(shortcode);
  console.log('mediaId', mediaId);

  const pageRes = await axios.get(pageUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
    },
    validateStatus: () => true,
  });

  const html = String(pageRes.data);
  const cookies = pageRes.headers['set-cookie'] || [];
  const csrf = cookies.join(';').match(/csrftoken=([^;]+)/)?.[1];
  const lsd = extractLsdToken(html);

  console.log('page status', pageRes.status, 'len', html.length);
  console.log('csrf', csrf ? 'yes' : 'no', 'lsd', lsd ? 'yes' : 'no');

  if (!lsd) return;

  const body = new URLSearchParams({
    av: '0',
    __d: 'www',
    __user: '0',
    dpr: '1',
    lsd,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
    server_timestamps: 'true',
    variables: JSON.stringify({ media_id: mediaId }),
    doc_id: '27130156389949648',
  });

  const gqlRes = await axios.post('https://www.instagram.com/api/graphql', body.toString(), {
    headers: {
      'User-Agent': UA,
      'X-IG-App-ID': '936619743392459',
      'X-ASBD-ID': '359341',
      'X-IG-WWW-Claim': '0',
      Origin: 'https://www.instagram.com',
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-Friendly-Name': 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
      'X-CSRFToken': csrf || '',
      'X-FB-LSD': lsd,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: pageUrl,
      Cookie: cookies.map((c) => c.split(';')[0]).join('; '),
    },
    validateStatus: () => true,
  });

  console.log('graphql status', gqlRes.status);
  const data = gqlRes.data;
  console.log('response', JSON.stringify(data).slice(0, 500));
  const product = data?.data?.xig_polaris_media?.if_not_gated_logged_out;
  console.log('has product', !!product);
  const video = findVideoUrl(product) || findVideoUrl(data);
  console.log('video', video?.slice(0, 120) || 'none');
  if (!video) console.log('keys', Object.keys(data?.data || {}));
}

main().catch(console.error);
