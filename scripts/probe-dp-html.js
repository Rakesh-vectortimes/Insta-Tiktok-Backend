const fs = require('fs');
const { igAxios, chromeDocumentHeaders, chromeApiHeaders } = require('../src/utils/igHttp');

async function main() {
  const username = process.argv[2] || 'sundeepkishan';
  const profileUrl = `https://www.instagram.com/${username}/`;
  const { data } = await igAxios.get(profileUrl, { headers: chromeDocumentHeaders() });
  const html = String(data);
  fs.writeFileSync('scripts/dp-page-snippet.txt', html.slice(0, 500000));

  const patterns = [
    /profile_pic_url_hd[^:]*:\s*"([^"]+)"/g,
    /profile_pic_url[^:]*:\s*"([^"]+)"/g,
    /"profile_pic_url_hd":"((?:\\.|[^"\\])*)"/g,
  ];

  for (const re of patterns) {
    const matches = [...html.matchAll(re)].map((m) => m[1]).slice(0, 5);
    console.log(re.source, matches.length);
    for (const m of matches) {
      const decoded = m.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      console.log(' ', decoded.match(/s\d+x\d+/)?.[0], decoded.slice(0, 100));
    }
  }

  // GraphQL profile doc
  const docIds = ['17888432820036766', '24192455360852224', '46929202502872235'];
  for (const docId of docIds) {
    const variables = JSON.stringify({ username, include_reel: true });
    const url = `https://www.instagram.com/graphql/query/?doc_id=${docId}&variables=${encodeURIComponent(variables)}`;
    const res = await igAxios.get(url, {
      headers: chromeApiHeaders(profileUrl),
      validateStatus: () => true,
    });
    const text = JSON.stringify(res.data);
    const hd = text.match(/profile_pic_url_hd[^"]*"([^"]+)"/);
    const std = text.match(/profile_pic_url[^h][^"]*"([^"]+)"/);
    console.log('graphql', docId, 'status', res.status, 'hd', hd?.[1]?.match(/s\d+x\d+/)?.[0]);
  }
}

main();
