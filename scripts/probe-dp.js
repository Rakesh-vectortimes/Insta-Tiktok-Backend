const { igAxios, chromeDocumentHeaders, chromeApiHeaders } = require('../src/utils/igHttp');
const { getProfileDp } = require('../src/services/igScraper');

async function jpegDims(url) {
  const { data } = await igAxios.get(url, {
    responseType: 'arraybuffer',
    headers: { Referer: 'https://www.instagram.com/' },
    validateStatus: () => true,
  });
  const buf = Buffer.from(data);
  for (let i = 0; i < buf.length - 8; i++) {
    if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)) {
      return { bytes: buf.length, w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), status: 200 };
    }
  }
  return { bytes: buf.length, status: buf.length < 100 ? 'tiny' : 'unknown' };
}

async function main() {
  const username = process.argv[2] || 'sundeepkishan';
  const profileUrl = `https://www.instagram.com/${username}/`;

  const api = await igAxios.get(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
    { headers: chromeApiHeaders(profileUrl), validateStatus: () => true }
  );
  const user = api.data?.data?.user;
  console.log('API status', api.status);
  if (user) {
    for (const key of ['profile_pic_url_hd', 'profile_pic_url']) {
      const url = user[key];
      const dims = url ? await jpegDims(url) : null;
      console.log(key, url?.match(/s\d+x\d+/)?.[0], dims);
    }
  }

  const page = await igAxios.get(profileUrl, { headers: chromeDocumentHeaders(), validateStatus: () => true });
  const html = String(page.data);
  const dpFromPage =
    html.match(/"profile_pic_url_hd":"((?:\\.|[^"\\])*)"/)?.[1] ||
    html.match(/property="og:image" content="([^"]+)"/)?.[1];
  console.log('page dp size', dpFromPage?.match(/s\d+x\d+/)?.[0], 'og?', !html.includes('profile_pic_url_hd'));
  if (dpFromPage) {
    const url = dpFromPage.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    console.log('page dims', await jpegDims(url));
  }

  const profile = await getProfileDp(username);
  console.log('getProfileDp dims', await jpegDims(profile.dpUrl));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
