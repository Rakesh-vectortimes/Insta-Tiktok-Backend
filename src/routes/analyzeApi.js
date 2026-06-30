const express = require('express');
const rateLimit = require('express-rate-limit');
const { urlHash } = require('../utils/urlHash');
const { isRedisEnabled } = require('../services/redis');
const { getVideoCache, setJobLock, getJobLock } = require('../services/videoCache');
const { addDownloadJob, getDownloadJobStatus } = require('../services/jobQueue');

const router = express.Router();

const analyzeLimiter = rateLimit({
  windowMs: parseInt(process.env.ANALYZE_RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.ANALYZE_RATE_LIMIT_MAX || '20', 10),
  message: { error: 'Too many requests. Please try again later.', retryable: true },
});

router.post('/analyze', analyzeLimiter, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  if (!isRedisEnabled()) {
    return res.status(503).json({
      error: 'Analyze pipeline requires REDIS_URL',
      retryable: true,
    });
  }

  try {
    const hash = urlHash(url);
    const cached = await getVideoCache(hash);

    if (cached) {
      return res.json({
        status: 'completed',
        cached: true,
        data: cached,
      });
    }

    const existingJobId = await getJobLock(hash);
    if (existingJobId) {
      return res.json({
        status: 'processing',
        deduplicated: true,
        job_id: existingJobId,
      });
    }

    const job = await addDownloadJob({ url, hash });
    await setJobLock(hash, job.id);

    return res.status(202).json({
      status: 'processing',
      job_id: job.id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, retryable: true });
  }
});

router.get('/status/:jobId', async (req, res) => {
  if (!isRedisEnabled()) {
    return res.status(503).json({ error: 'REDIS_URL required' });
  }

  try {
    const status = await getDownloadJobStatus(req.params.jobId);
    if (status.status === 'not_found') {
      return res.status(404).json(status);
    }
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/prewarm', async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || !urls.length) {
    return res.status(400).json({ error: 'urls array required' });
  }

  if (!isRedisEnabled()) {
    return res.status(503).json({ error: 'REDIS_URL required' });
  }

  let queued = 0;
  let skipped = 0;

  for (const url of urls) {
    const hash = urlHash(url);
    const cached = await getVideoCache(hash);
    if (cached) {
      skipped += 1;
      continue;
    }

    const existingJobId = await getJobLock(hash);
    if (existingJobId) {
      skipped += 1;
      continue;
    }

    const job = await addDownloadJob(
      { url, hash },
      { priority: 10, removeOnComplete: true }
    );
    await setJobLock(hash, job.id);
    queued += 1;
  }

  res.json({
    status: 'queued',
    queued,
    skipped,
    total: urls.length,
  });
});

module.exports = router;
