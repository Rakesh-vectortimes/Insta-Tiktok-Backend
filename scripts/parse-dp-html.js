const fs = require('fs');

const html = fs.readFileSync('scripts/dp-page-snippet.txt', 'utf8');
console.log('profile_pic_url_hd count', (html.match(/profile_pic_url_hd/g) || []).length);
console.log('profile_pic_url count', (html.match(/profile_pic_url/g) || []).length);

for (const marker of ['profile_pic_url_hd', 'profile_pic_url', 'xdt_api__v1__feed__user']) {
  const idx = html.indexOf(marker);
  if (idx >= 0) console.log(marker, 'at', idx, html.slice(idx, idx + 200));
}

const scriptRe = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
let i = 0;
for (const match of html.matchAll(scriptRe)) {
  const raw = match[1];
  if (!raw.includes('profile_pic')) continue;
  i += 1;
  try {
    const parsed = JSON.parse(raw);
    const text = JSON.stringify(parsed);
    const hd = text.match(/profile_pic_url_hd\\":\\"(https:[^\\]+)/);
    const std = text.match(/profile_pic_url\\":\\"(https:[^\\]+)/);
    console.log('script', i, 'hd', hd?.[1]?.slice(0, 120));
    console.log('script', i, 'std', std?.[1]?.slice(0, 120));
  } catch {
    const hd = raw.match(/profile_pic_url_hd[^"]*"([^"]+)"/);
    console.log('script', i, 'raw hd', hd?.[1]?.slice(0, 120));
  }
}
