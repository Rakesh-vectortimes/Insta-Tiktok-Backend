require('dotenv').config();
const { writeCookiesFromEnv, hasCookieFile, getCookieFile, getCookieExpiryInfo } = require('./utils/cookies');

writeCookiesFromEnv();

const { connectRedis } = require('./services/redis');
const { initSessionPool } = require('./services/sessionPool');

initSessionPool();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const instagramRoutes = require('./routes/instagram');
const tiktokRoutes = require('./routes/tiktok');
const jobRoutes = require('./routes/jobs');
const analyzeApiRoutes = require('./routes/analyzeApi');
const { cleanupTemp } = require('./utils/cleanup');
const { globalLimiter, getActiveCount } = require('./utils/globalLimiter');
const { cacheStats } = require('./services/cache');
const { downloadQueue, sessionQueue } = require('./services/requestQueue');
const { poolStats } = require('./services/sessionPool');
const { redisStatus } = require('./services/redis');
const { queueStats } = require('./services/jobQueue');
const { storageStatus } = require('./services/storage');
const { videoCacheStats } = require('./services/videoCache');
const path = require('path');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Downloader API Docs',
}));
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

const limiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '600000', 10),
  max: parseInt(process.env.API_RATE_LIMIT_MAX || '30', 10),
  message: { error: 'Too many requests. Please slow down.', retryable: true },
});

app.use('/api/', globalLimiter);

app.use('/api', analyzeApiRoutes);

app.use('/api/', limiter);

app.use('/api/instagram', instagramRoutes);
app.use('/api/tiktok', tiktokRoutes);
app.use('/api/jobs', jobRoutes);

app.get('/', (req, res) => {
  res.json({
    name: 'downloader-backend',
    status: 'running',
    docs: '/api-docs',
    health: '/health',
    endpoints: {
      analyze: {
        submit: 'POST /api/analyze',
        status: 'GET /api/status/:jobId',
        prewarm: 'POST /api/prewarm',
      },
      instagram: {
        reel: 'POST /api/instagram/reel',
        post: 'POST /api/instagram/post',
        carouselZip: 'POST /api/instagram/carousel/zip',
        dp: 'GET /api/instagram/dp/:username',
        story: 'POST /api/instagram/story',
      },
      jobs: {
        analyze: 'POST /api/jobs/analyze',
        status: 'GET /api/jobs/:jobId',
      },
      tiktok: {
        video: 'POST /api/tiktok/video',
        audio: 'POST /api/tiktok/audio',
        slideshow: 'POST /api/tiktok/slideshow',
      },
    },
  });
});

app.get('/health', async (req, res) => {
  const cookiesPresent = hasCookieFile();
  const expiryInfo = cookiesPresent ? getCookieExpiryInfo() : null;

  const response = {
    status: 'ok',
    instagramCookies: cookiesPresent
      ? path.basename(getCookieFile())
      : 'not configured',
    activeRequests: getActiveCount(),
    redis: await redisStatus(),
    cache: cacheStats(),
    videoCache: videoCacheStats(),
    storage: storageStatus(),
    sessionPool: await poolStats(),
    jobQueue: await queueStats(),
    queues: {
      download: downloadQueue.stats(),
      session: sessionQueue.stats(),
    },
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

  const pool = response.sessionPool;
  if (pool.total > 0 && pool.available === 0) {
    response.warning =
      response.warning ||
      'All Instagram sessions are cooling down or over daily limit.';
  }

  res.json(response);
});

setInterval(cleanupTemp, 30 * 60 * 1000);

const PORT = process.env.PORT || 4000;

connectRedis().then(() => {
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
});
