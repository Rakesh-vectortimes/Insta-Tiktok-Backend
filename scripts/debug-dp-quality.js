const {
  igAxios,
  iphoneHeaders,
  chromeApiHeaders,
  chromeDocumentHeaders,
} = require('../src/utils/igHttp');

async function testApi(username) {
  const profileUrl = `https://www.instagram.com/${username}/`;
  const page = await igAxios.get(profileUrl, { headers: chromeDocumentHeaders() });
  const html = String(page.data);
  const lsd = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1];
  const csrf = html.match(/"csrf_token":"([^"]+)"/)?.[1];
  const headers = {
    ...chromeApiHeaders(profileUrl),
    'X-FB-LSD': lsd,
    Cookie: csrf ? `csrftoken=${csrf};` : undefined,
  };
  const res = await igAxios.get(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
    { headers, validateStatus: () => true }
  );
  const user = res.data?.data?.user;
  console.log('API', res.status, 'hd', user?.profile_pic_url_hd?.match(/s\d+x\d+/)?.[0]);
  if (res.status !== 200) {
    console.log('API body', JSON.stringify(res.data).slice(0, 300));
  }
  console.log('tokens', { lsd: !!lsd, csrf: !!csrf });
}

async function testPage(username) {
  for (const [name, headers] of [
    ['iphone', iphoneHeaders()],
    ['chrome', chromeDocumentHeaders()],
  ]) {
    const res = await igAxios.get(`https://www.instagram.com/${username}/`, {
      headers,
      validateStatus: () => true,
    });
    const h = String(res.data);
    const og = h.match(/property="og:image" content="([^"]+)"/)?.[1];
    const hdCount = (h.match(/profile_pic_url_hd/g) || []).length;
    console.log(name, 'status', res.status, 'og', og?.match(/s\d+x\d+/)?.[0], 'hd fields', hdCount);
  }
}

async function testEmbed(username) {
  const res = await igAxios.get(`https://www.instagram.com/${username}/embed/`, {
    headers: iphoneHeaders(),
    validateStatus: () => true,
  });
  const h = String(res.data);
  console.log(
    'embed',
    res.status,
    'hd fields',
    (h.match(/profile_pic_url_hd/g) || []).length,
    'og sizes',
    ['s100x100', 's320x320'].map((s) => s + ':' + (h.match(new RegExp(s, 'g')) || []).length).join(' ')
  );
}

async function main() {
  const u = process.argv[2] || 'utharayini';
  await testPage(u);
  await testEmbed(u);
  await testApi(u);
}

main();
