const { igAxios, chromeApiHeaders, iphoneHeaders } = require('../src/utils/igHttp');

const IG_APP_ID = '936619743392459';
const ANDROID_UA = 'Instagram 269.0.0.18.75 Android (26/8.0.0; 420dpi; 1080x1920; samsung; SM-G935F; hero2lte; samsungexynos8890; en_US; 314665256)';

async function tryEndpoint(name, url, headers) {
  const res = await igAxios.get(url, { headers, validateStatus: () => true });
  const user = res.data?.data?.user || res.data?.user;
  const hd = user?.profile_pic_url_hd || user?.hd_profile_pic_url_info?.url;
  const std = user?.profile_pic_url;
  console.log(name, 'status', res.status, 'hd', hd?.match(/s\d+x\d+/)?.[0], 'std', std?.match(/s\d+x\d+/)?.[0]);
  if (res.status !== 200) {
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    console.log('  body', body.slice(0, 120));
  }
  return user;
}

async function main() {
  const username = process.argv[2] || 'sundeepkishan';
  const profileUrl = `https://www.instagram.com/${username}/`;

  await tryEndpoint(
    'web_profile_info',
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
    chromeApiHeaders(profileUrl)
  );

  await tryEndpoint(
    'i.instagram web_profile_info',
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
    {
      'User-Agent': ANDROID_UA,
      'X-IG-App-ID': IG_APP_ID,
      Accept: 'application/json',
    }
  );

  const docIds = [
    ['24192455360852224', { username, render_surface: 'PROFILE' }],
    ['46929202502872235', { username }],
    ['17888432820036766', { user_id: null, username }],
    ['25025320', { id: null, username, include_reel: true }],
  ];

  for (const [docId, vars] of docIds) {
    const url = `https://www.instagram.com/graphql/query/?doc_id=${docId}&variables=${encodeURIComponent(JSON.stringify(vars))}`;
    const res = await igAxios.get(url, { headers: chromeApiHeaders(profileUrl), validateStatus: () => true });
    const text = JSON.stringify(res.data);
    const hdMatch = text.match(/profile_pic_url_hd\\":\\"(https:[^\\]+)/) || text.match(/"profile_pic_url_hd":"(https:[^"]+)"/);
    console.log('graphql', docId, 'status', res.status, 'hd', hdMatch?.[1]?.match(/s\d+x\d+/)?.[0]);
  }

  const page = await igAxios.get(profileUrl, { headers: iphoneHeaders(), validateStatus: () => true });
  const html = String(page.data);
  const userId = html.match(/"user_id":"(\d+)"/)?.[1] || html.match(/"pk":(\d+)/)?.[1];
  console.log('userId from page', userId);
}

main();
