const { igAxios, iphoneHeaders } = require('../src/utils/igHttp');

function findDeep(obj, key, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  const value = obj[key];
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDeep(item, key, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const k of Object.keys(obj)) {
    const found = findDeep(obj[k], key, depth + 1);
    if (found) return found;
  }
  return null;
}

async function main() {
  const u = process.argv[2] || 'priyabhavanishankar';
  const { data } = await igAxios.get(`https://www.instagram.com/${u}/`, {
    headers: iphoneHeaders(),
  });
  const h = String(data);

  const hdRegex = [...h.matchAll(/"profile_pic_url_hd":"((?:\\.|[^"\\])*)"/g)];
  console.log('hd regex count', hdRegex.length);
  if (hdRegex[0]) console.log('first', hdRegex[0][1].slice(0, 120));

  let scriptHits = 0;
  for (const match of h.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const json = JSON.parse(match[1]);
      const hd = findDeep(json, 'profile_pic_url_hd');
      if (hd) {
        scriptHits += 1;
        console.log('script hd', hd.match(/s\d+x\d+/)?.[0], hd.slice(0, 100));
      }
    } catch {
      // ignore
    }
  }
  console.log('script blocks with hd', scriptHits);
}

main();
