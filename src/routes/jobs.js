const express = require('express');
const { analyzeUrl } = require('../services/analyzeUrl');
const { enqueueAnalyzeJob, getJobStatus } = require('../services/jobQueue');

const router = express.Router();

router.post('/analyze', async (req, res) => {
  const { url, mode = 'reel' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const jobId = await enqueueAnalyzeJob({ url, mode });
    res.status(202).json({
      status: 'queued',
      jobId,
      pollUrl: `/api/jobs/${jobId}`,
    });
  } catch (err) {
    res.status(503).json({
      error: err.message,
      retryable: true,
      hint: 'Set REDIS_URL and run npm run worker for async jobs',
    });
  }
});

router.get('/:jobId', async (req, res) => {
  try {
    const status = await getJobStatus(req.params.jobId);
    if (status.status === 'not_found') {
      return res.status(404).json(status);
    }
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
