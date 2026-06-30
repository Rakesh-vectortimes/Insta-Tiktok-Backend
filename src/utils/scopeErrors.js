const { parseUrl } = require('../services/urlParser');

const SCOPE_MESSAGE =
  "This content can't be downloaded — it's private, a story, or requires login. We only support public posts and reels viewable without logging in.";

const UNAVAILABLE_MESSAGE =
  'This content could not be accessed. It may be private, a story, or temporarily unavailable. If you cannot view it in a logged-out browser tab, we cannot fetch it either.';

const REASON_CODES = {
  PRIVATE_OR_STORY: 'private_or_story',
  PUBLIC_EMBED_VIDEO_STRIPPED: 'public_embed_video_stripped',
  RATE_LIMITED: 'rate_limited',
};

function isSessionFallbackEnabled() {
  return process.env.ALLOW_SESSION_FALLBACK === 'true';
}

function assertPublicScope(url) {
  const parsed = parseUrl(url);
  if (!parsed) return;

  if (parsed.type === 'story') {
    const err = new Error(
      'Stories are not supported in public-only mode. We only support public posts and reels.'
    );
    err.scopeLimited = true;
    err.retryable = false;
    throw err;
  }
}

function createPublicScopeError(cause) {
  const msg = (cause?.message || '').toLowerCase();

  if (msg.includes('not available in public embed')) {
    const err = new Error(SCOPE_MESSAGE);
    err.scopeLimited = true;
    err.retryable = false;
    err.reasonCode = REASON_CODES.PUBLIC_EMBED_VIDEO_STRIPPED;
    return err;
  }

  if (msg.includes('rate-limit') || msg.includes('rate limit') || msg.includes('too many requests')) {
    const err = new Error(UNAVAILABLE_MESSAGE);
    err.scopeLimited = true;
    err.retryable = true;
    err.reasonCode = REASON_CODES.RATE_LIMITED;
    if (cause?.message) err.details = cause.message;
    return err;
  }

  if (
    msg.includes('private') ||
    msg.includes('story') ||
    msg.includes('login') ||
    msg.includes('authentication') ||
    msg.includes('auth required') ||
    msg.includes('thumbnail only') ||
    msg.includes('requires login')
  ) {
    const err = new Error(SCOPE_MESSAGE);
    err.scopeLimited = true;
    err.retryable = false;
    err.reasonCode = REASON_CODES.PRIVATE_OR_STORY;
    return err;
  }

  const err = new Error(UNAVAILABLE_MESSAGE);
  err.scopeLimited = true;
  err.retryable = true;
  err.reasonCode = REASON_CODES.RATE_LIMITED;
  if (cause?.message) err.details = cause.message;
  return err;
}

module.exports = {
  isSessionFallbackEnabled,
  assertPublicScope,
  createPublicScopeError,
  SCOPE_MESSAGE,
  UNAVAILABLE_MESSAGE,
  REASON_CODES,
};
