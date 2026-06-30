require('dotenv').config();

const { Worker } = require('bullmq');
const { connectRedis, getRedis } = require('./services/redis');
const { initSessionPool } = require('./services/sessionPool');
const { writeCookiesFromEnv } = require('./utils/cookies');
const { analyzeUrl } = require('./services/analyzeUrl');

const QUEUE_NAME = 'analyze';
const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

async function startWorker() {
  writeCookiesFromEnv();
  initSessionPool();

  const connected = await connectRedis();
  if (!connected) {
    console.error('[worker] REDIS_URL required');
    process.exit(1);
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { url, mode = 'reel', sessionid } = job.data;
      return analyzeUrl(url, { mode, sessionid, fromWorker: true });
    },
    {
      connection: getRedis(),
      concurrency,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message);
  });

  console.log(`[worker] BullMQ worker running (concurrency=${concurrency})`);
}

startWorker().catch((err) => {
  console.error('[worker] startup failed:', err);
  process.exit(1);
});
