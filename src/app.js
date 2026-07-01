require('dotenv').config();
console.log('[scope] Public-only mode — session fallback disabled');

const { connectRedis } = require('./services/redis');

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
const { downloadQueue } = require('./services/requestQueue');
const { redisStatus } = require('./services/redis');
const { queueStats } = require('./services/jobQueue');
const { videoCacheStats } = require('./services/videoCache');
const { inFlightStats } = require('./services/inFlightDedup');
const { storageStatus } = require('./services/storage');
const { getProxyStatus } = require('./utils/igHttp');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

function swaggerSpecForRequest(req) {
  const spec = JSON.parse(JSON.stringify(swaggerSpec));
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.get('host');
  spec.servers = [
    { url: `${proto}://${host}`, description: 'Current server' },
    { url: 'http://localhost:4000', description: 'Local development' },
  ];
  return spec;
}

app.use('/api-docs', swaggerUi.serve, (req, res, next) => {
  swaggerUi.setup(swaggerSpecForRequest(req), {
    customSiteTitle: 'Downloader API Docs',
  })(req, res, next);
});
app.get('/api-docs.json', (req, res) => res.json(swaggerSpecForRequest(req)));

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
        postStream: 'GET /api/instagram/post/stream',
        carouselZip: 'POST /api/instagram/carousel/zip',
        carouselStream: 'GET /api/instagram/carousel/stream',
        carouselSlide: 'GET /api/instagram/carousel/slide',
        dp: 'GET /api/instagram/dp/:username',
        dpDownload: 'GET /api/instagram/dp/:username/download',
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
  const response = {
    status: 'ok',
    mode: 'public-only',
    instagramCookies: 'disabled (public-only)',
    activeRequests: getActiveCount(),
    inFlight: inFlightStats(),
    redis: await redisStatus(),
    cache: cacheStats(),
    videoCache: videoCacheStats(),
    storage: storageStatus(),
    jobQueue: await queueStats(),
    queues: {
      download: downloadQueue.stats(),
    },
    proxy: getProxyStatus(),
  };

  res.json(response);
});

setInterval(cleanupTemp, 30 * 60 * 1000);

const PORT = process.env.PORT || 4000;

connectRedis().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    const proxy = getProxyStatus();
    if (proxy.enabled) {
      console.log(`[proxy] Instagram metadata via ${proxy.host}:${proxy.port}`);
    } else if (proxy.configured === 'invalid') {
      console.warn('[proxy] IG_HTTP_PROXY is set but invalid — proxy disabled');
    }
    console.log(`✅ Server running on port ${PORT} (public-only)`);
  });
});
