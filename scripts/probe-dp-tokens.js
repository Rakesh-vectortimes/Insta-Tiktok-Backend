const { igAxios, chromeDocumentHeaders, chromeApiHeaders } = require('../src/utils/igHttp');

function extractPageTokens(html) {
  const lsd =
    html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ||
    html.match(/"lsd":"([^"]+)"/)?.[1] ||
    html.match(/name="lsd" value="([^"]+)"/)?.[1];
  const csrf = html.match(/"csrf_token":"([^"]+)"/)?.[1];
  const appId = html.match(/"APP_ID":"(\d+)"/)?.[1];
  return { lsd, csrf, appId };
}

async function fetchProfile(username, extraHeaders = {}) {
  const profileUrl = `https://www.instagram.com/${username}/`;
  const page = await igAxios.get(profileUrl, { headers: chromeDocumentHeaders() });
  const html = String(page.data);
  const tokens = extractPageTokens(html);

  const headers = {
    ...chromeApiHeaders(profileUrl),
    ...extraHeaders,
  };
  if (tokens.lsd) {
    headers['X-FB-LSD'] = tokens.lsd;
    headers['X-CSRFToken'] = tokens.csrf || tokens.lsd;
  }
  if (tokens.csrf) {
    headers.Cookie = `csrftoken=${tokens.csrf};`;
  }

  const api = await igAxios.get(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
    { headers, validateStatus: () => true }
  );

  const user = api.data?.data?.user;
  return {
    apiStatus: api.status,
    tokens,
    hd: user?.profile_pic_url_hd?.match(/s\d+x\d+/)?.[0],
    std: user?.profile_pic_url?.match(/s\d+x\d+/)?.[0],
    body: api.status !== 200 ? JSON.stringify(api.data).slice(0, 150) : null,
  };
}

async function main() {
  const username = process.argv[2] || 'sundeepkishan';
  console.log('plain api', await fetchProfile(username));

  const profileUrl = `https://www.instagram.com/${username}/`;
  const page = await igAxios.get(profileUrl, { headers: chromeDocumentHeaders() });
  const html = String(page.data);
  const userId = html.match(/"user_id":"(\d+)"/)?.[1];
  const tokens = extractPageTokens(html);
  const headers = {
    ...chromeApiHeaders(profileUrl),
    'X-FB-LSD': tokens.lsd,
    Cookie: tokens.csrf ? `csrftoken=${tokens.csrf};` : undefined,
  };

  if (userId) {
    for (const base of ['https://www.instagram.com', 'https://i.instagram.com']) {
      const url = `${base}/api/v1/users/${userId}/info/`;
      const res = await igAxios.get(url, { headers, validateStatus: () => true });
      const user = res.data?.user || res.data?.data?.user;
      console.log(url, 'status', res.status, 'hd', user?.profile_pic_url_hd?.match(/s\d+x\d+/)?.[0]);
    }
  }
}

main();
