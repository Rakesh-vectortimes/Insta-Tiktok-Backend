const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

function getAccessKeyId() {
  return process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY;
}

function getSecretAccessKey() {
  return process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY;
}

function isStorageEnabled() {
  return Boolean(
    process.env.R2_BUCKET &&
      getAccessKeyId() &&
      getSecretAccessKey() &&
      process.env.R2_PUBLIC_URL
  );
}

function getS3Client() {
  const endpoint =
    process.env.R2_ENDPOINT ||
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: getAccessKeyId(),
      secretAccessKey: getSecretAccessKey(),
    },
  });
}

function guessContentType(url = '', ext = '') {
  const ref = `${url} ${ext}`.toLowerCase();
  if (ref.includes('.mp4') || ref.includes('video')) return 'video/mp4';
  if (ref.includes('.mp3')) return 'audio/mpeg';
  if (ref.includes('.png')) return 'image/png';
  if (ref.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function buildObjectKey(mediaUrl, ext = 'mp4') {
  const safeExt = ext.replace(/^\./, '') || 'bin';
  return `media/${new Date().toISOString().slice(0, 10)}/${uuidv4()}.${safeExt}`;
}

async function uploadToR2(fileName, buffer, ext = 'mp4') {
  const client = getS3Client();
  const contentType = guessContentType('', ext);

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=86400',
    })
  );

  const base = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/${fileName}`;
}

async function uploadBuffer(buffer, key, contentType) {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  const base = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/${key}`;
}

async function mirrorMediaUrl(mediaUrl, ext = 'mp4') {
  if (!isStorageEnabled() || process.env.MIRROR_TO_CDN !== 'true') {
    return null;
  }

  try {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://www.instagram.com/',
      },
    });

    const key = buildObjectKey(mediaUrl, ext);
    const contentType = guessContentType(mediaUrl, ext);
    return await uploadBuffer(Buffer.from(response.data), key, contentType);
  } catch (err) {
    console.warn('[storage] CDN mirror failed:', err.message);
    return null;
  }
}

async function enrichWithCdn(result) {
  if (!result?.url || result.cdnUrl) return result;

  const cdnUrl = await mirrorMediaUrl(result.url, result.ext || 'mp4');
  if (!cdnUrl) return result;

  return { ...result, cdnUrl, downloadUrl: cdnUrl };
}

function storageStatus() {
  return {
    enabled: isStorageEnabled(),
    mirrorActive: process.env.MIRROR_TO_CDN === 'true',
    bucket: process.env.R2_BUCKET || null,
    publicUrl: process.env.R2_PUBLIC_URL || null,
  };
}

module.exports = {
  isStorageEnabled,
  uploadToR2,
  mirrorMediaUrl,
  enrichWithCdn,
  storageStatus,
};
