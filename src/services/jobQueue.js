const { Queue } = require('bullmq');
const { isRedisEnabled, getRedis } = require('./redis');

const QUEUE_NAME = 'download-video';
const LEGACY_QUEUE_NAME = 'analyze';

let downloadQueue = null;
let legacyAnalyzeQueue = null;

function getConnection() {
  return { connection: getRedis() };
}

function getDownloadQueue() {
  if (!isRedisEnabled()) return null;
  if (!downloadQueue) {
    downloadQueue = new Queue(QUEUE_NAME, {
      ...getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  return downloadQueue;
}

function getLegacyAnalyzeQueue() {
  if (!isRedisEnabled()) return null;
  if (!legacyAnalyzeQueue) {
    legacyAnalyzeQueue = new Queue(LEGACY_QUEUE_NAME, getConnection());
  }
  return legacyAnalyzeQueue;
}

async function addDownloadJob({ url, hash }, options = {}) {
  const queue = getDownloadQueue();
  if (!queue) {
    throw new Error('REDIS_URL required for download queue');
  }

  const job = await queue.add('download-video', { url, hash }, options);
  return job;
}

async function getDownloadJobStatus(jobId) {
  const queue = getDownloadQueue();
  if (!queue) return { status: 'unavailable' };

  const job = await queue.getJob(jobId);
  if (!job) {
    return { status: 'not_found', job_id: jobId };
  }

  const state = await job.getState();

  return {
    job_id: job.id,
    status: state,
    progress: job.progress,
    result: job.returnvalue || null,
    failed_reason: job.failedReason || null,
  };
}

async function enqueueAnalyzeJob(payload) {
  const queue = getLegacyAnalyzeQueue();
  if (!queue) throw new Error('Job queue requires REDIS_URL');
  const job = await queue.add('analyze', payload);
  return job.id;
}

async function getJobStatus(jobId) {
  const queue = getLegacyAnalyzeQueue();
  if (!queue) return { status: 'unavailable' };

  const job = await queue.getJob(jobId);
  if (!job) return { status: 'not_found', jobId };

  const state = await job.getState();
  const response = { jobId, status: state, progress: job.progress };

  if (state === 'completed') response.result = job.returnvalue;
  else if (state === 'failed') response.error = job.failedReason;

  return response;
}

async function queueStats() {
  const queue = getDownloadQueue();
  if (!queue) {
    return { enabled: false, name: QUEUE_NAME };
  }

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    enabled: true,
    name: QUEUE_NAME,
    waiting,
    active,
    completed,
    failed,
    delayed,
  };
}

module.exports = {
  QUEUE_NAME,
  getDownloadQueue,
  addDownloadJob,
  getDownloadJobStatus,
  enqueueAnalyzeJob,
  getJobStatus,
  queueStats,
};
