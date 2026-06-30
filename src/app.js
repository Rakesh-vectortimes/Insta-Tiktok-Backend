require('dotenv').config();
const { writeCookiesFromEnv, hasCookieFile, getCookieFile, getCookieExpiryInfo } = require('./utils/cookies');

writeCookiesFromEnv();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const instagramRoutes = require('./routes/instagram');
const tiktokRoutes = require('./routes/tiktok');
const { cleanupTemp } = require('./utils/cleanup');
const path = require('path');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Downloader API Docs',
}));
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

// Rate limiting — 30 requests per 10 minutes per IP
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please slow down.' }
});
app.use('/api/', limiter);

app.use('/api/instagram', instagramRoutes);
app.use('/api/tiktok', tiktokRoutes);

app.get('/', (req, res) => {
  res.json({
    name: 'downloader-backend',
    status: 'running',
    docs: '/api-docs',
    health: '/health',
    endpoints: {
      instagram: {
        reel: 'POST /api/instagram/reel',
        post: 'POST /api/instagram/post',
        carouselZip: 'POST /api/instagram/carousel/zip',
        dp: 'GET /api/instagram/dp/:username',
        story: 'POST /api/instagram/story'
      },
      tiktok: {
        video: 'POST /api/tiktok/video',
        audio: 'POST /api/tiktok/audio',
        slideshow: 'POST /api/tiktok/slideshow'
      }
    }
  });
});

app.get('/health', (req, res) => {
  const cookiesPresent = hasCookieFile();
  const expiryInfo = cookiesPresent ? getCookieExpiryInfo() : null;

  const response = {
    status: 'ok',
    instagramCookies: cookiesPresent
      ? path.basename(getCookieFile())
      : 'not configured',
  };

  if (expiryInfo) {
    response.cookieExpiry = expiryInfo;

    if (expiryInfo.isExpired) {
      response.warning =
        'Instagram session has expired. Re-export cookies.txt and update COOKIES_TXT_CONTENT.';
    } else if (expiryInfo.isExpiringSoon) {
      response.warning = `Instagram session expires in ${expiryInfo.daysRemaining} day(s). Consider refreshing soon.`;
    }
  }

  res.json(response);
});

// Clean temp files every 30 minutes
setInterval(cleanupTemp, 30 * 60 * 1000);

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  if (hasCookieFile()) {
    console.log(`🍪 Instagram cookies loaded: ${path.basename(getCookieFile())}`);
    const expiry = getCookieExpiryInfo();
    if (expiry) {
      if (expiry.isExpired) {
        console.warn('⚠️  Instagram session has EXPIRED — re-export cookies.txt');
      } else if (expiry.isExpiringSoon) {
        console.warn(`⚠️  Instagram session expires in ${expiry.daysRemaining} days`);
      } else {
        console.log(`✅ Instagram session valid for ${expiry.daysRemaining} more days`);
      }
    }
  } else {
    console.warn('⚠️  No Instagram cookies found — add cookies.txt locally or set COOKIES_TXT_CONTENT in Railway Variables');
  }
});
