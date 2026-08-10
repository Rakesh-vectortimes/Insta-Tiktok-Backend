const axios = require('axios');

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IG_APP_ID = '936619743392459';
const shortcode = 'DZFbef0KsWl';

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

const headers = {
  'User-Agent': UA,
  'X-IG-App-ID': IG_APP_ID,
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function tryEndpoint(name, url, opts = {}) {
  try {
    const { data, status } = await axios.get(url, {
      headers: { ...headers, ...opts.headers },
      validateStatus: () => true,
      timeout: 15000,
      ...opts,
    });
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const video =
      data?.items?.[0]?.video_versions?.[0]?.url ||
      data?.items?.[0]?.video_url ||
      data?.graphql?.shortcode_media?.video_url ||
      data?.data?.xdt_shortcode_media?.video_url ||
      data?.media?.video_url;
    console.log(`\n${name}`);
    console.log('  status', status, 'len', text.length);
    console.log('  video', video ? video.slice(0, 100) : 'none');
    if (status !== 200) console.log('  body', text.slice(0, 200));
  } catch (e) {
    console.log(`\n${name} ERROR`, e.message);
  }
}

async function tryGraphql(docId) {
  const variables = JSON.stringify({ shortcode });
  const url = `https://www.instagram.com/graphql/query/?doc_id=${docId}&variables=${encodeURIComponent(variables)}`;
  await tryEndpoint(`graphql doc_id=${docId}`, url);
}

async function main() {
  const mediaId = shortcodeToMediaId(shortcode);

  await tryEndpoint('media shortcode info', `https://www.instagram.com/api/v1/media/shortcode/${shortcode}/info/`);
  await tryEndpoint('media id info', `https://www.instagram.com/api/v1/media/${mediaId}/info/`);
  await tryEndpoint('mobile media id info', `https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
    headers: { 'User-Agent': 'Instagram 269.0.0.18.75 Android' },
  });

  for (const docId of [
    '8845758582119844699',
    '25981206651899035',
    '23898832573986324',
    '17888432820036766',
  ]) {
    await tryGraphql(docId);
  }
}

main();
