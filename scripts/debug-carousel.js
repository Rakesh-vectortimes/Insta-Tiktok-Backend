const { igAxios, iphoneHeaders } = require('../src/utils/igHttp');

const shortcode = process.argv[2] || 'DZsDvWZGpW2';
const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;

async function main() {
  const { data } = await igAxios.get(embedUrl, {
    headers: iphoneHeaders(),
    timeout: 15000,
  });
  const h = String(data);
  const raw = h.match(/"contextJSON":"((?:\\.|[^"\\])*)"/)?.[1];
  if (!raw) {
    console.log('no contextJSON');
    return;
  }
  const parsed = JSON.parse(JSON.parse(`"${raw}"`));
  const media = parsed?.gql_data?.shortcode_media;
  console.log('typename', media?.__typename);
  console.log('keys', Object.keys(media || {}));
  const sidecar =
    media?.edge_sidecar_to_children?.edges ||
    media?.carousel_media ||
    media?.children?.data;
  console.log('sidecar count', sidecar?.length || 0);
  console.log(
    'display_url matches',
    (h.match(/display_url/g) || []).length,
    'carousel_media',
    /carousel_media/.test(h)
  );
}

main().catch(console.error);
