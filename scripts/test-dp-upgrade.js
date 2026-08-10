const axios = require('axios');

async function dims(url) {
  const { data, status } = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.instagram.com/' },
    validateStatus: () => true,
  });
  const buf = Buffer.from(data);
  let w, h;
  for (let i = 0; i < buf.length - 8; i++) {
    if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)) {
      h = buf.readUInt16BE(i + 5);
      w = buf.readUInt16BE(i + 7);
      break;
    }
  }
  return { status, bytes: buf.length, w, h, hint: url.match(/s\d+x\d+/)?.[0] };
}

async function main() {
  const meta = await axios.get(
    'https://insta-tiktok-backend-production.up.railway.app/api/instagram/dp/sundeepkishan'
  );
  const base = meta.data.dpUrl;
  const variants = [
    base,
    base.replace(/s100x100/g, 's320x320'),
    base.replace(/s100x100/g, 's640x640'),
    base.replace(/s100x100/g, 's1080x1080'),
    base.replace(/dst-jpg_s\d+x\d+_/g, 'dst-jpg_s320x320_'),
    base.replace(/dst-jpg_s\d+x\d+_/g, 'dst-jpg_s640x640_'),
  ];
  for (const url of variants) {
    console.log(await dims(url));
  }
}

main();
