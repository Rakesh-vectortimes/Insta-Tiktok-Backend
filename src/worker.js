require('dotenv').config();

const { Worker } = require('bullmq');
const { connectRedis, getRedis } = require('./services/redis');
const { processDownloadJob } = require('./services/downloadProcessor');
const { clearJobLock } = require('./services/videoCache');
const { QUEUE_NAME } = require('./services/jobQueue');

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

async function startWorker() {
  console.log('[worker] Public-only mode');

  const connected = await connectRedis();
  if (!connected) {
    console.error('[worker] REDIS_URL required');
    process.exit(1);
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { url, hash } = job.data;
      return processDownloadJob({ url, hash });
    },
    {
      connection: getRedis(),
      concurrency,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`);
  });

  worker.on('failed', async (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message);
    if (job?.data?.hash) {
      await clearJobLock(job.data.hash);
    }
  });

  console.log(`[worker] ${QUEUE_NAME} worker running (concurrency=${concurrency})`);
}

startWorker().catch((err) => {
  console.error('[worker] startup failed:', err);
  process.exit(1);
});
