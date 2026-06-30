const { Queue, QueueEvents } = require('bullmq');
const { isRedisEnabled, getRedis } = require('./redis');

const QUEUE_NAME = 'analyze';
const JOB_TTL_SECONDS = parseInt(process.env.JOB_RESULT_TTL_SECONDS || '3600', 10);

let analyzeQueue = null;
let queueEvents = null;

function getConnection() {
  return { connection: getRedis() };
}

function getAnalyzeQueue() {
  if (!isRedisEnabled()) return null;
  if (!analyzeQueue) {
    analyzeQueue = new Queue(QUEUE_NAME, {
      ...getConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: JOB_TTL_SECONDS },
        removeOnFail: { age: JOB_TTL_SECONDS },
      },
    });
  }
  return analyzeQueue;
}

async function enqueueAnalyzeJob(payload) {
  const queue = getAnalyzeQueue();
  if (!queue) {
    const err = new Error('Job queue requires REDIS_URL');
    err.retryable = false;
    throw err;
  }

  const job = await queue.add('analyze', payload, {
    jobId: undefined,
  });

  return job.id;
}

async function getJobStatus(jobId) {
  const queue = getAnalyzeQueue();
  if (!queue) return { status: 'unavailable' };

  const job = await queue.getJob(jobId);
  if (!job) return { status: 'not_found', jobId };

  const state = await job.getState();
  const response = {
    jobId,
    status: state,
    progress: job.progress,
  };

  if (state === 'completed') {
    response.result = job.returnvalue;
  } else if (state === 'failed') {
    response.error = job.failedReason;
  }

  return response;
}

async function waitForJob(jobId, timeoutMs = 60000) {
  const queue = getAnalyzeQueue();
  if (!queue) throw new Error('Job queue unavailable');

  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, getConnection());
  }

  const job = await queue.getJob(jobId);
  if (!job) throw new Error('Job not found');

  const result = await job.waitUntilFinished(queueEvents, timeoutMs);
  return result;
}

async function queueStats() {
  const queue = getAnalyzeQueue();
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
  getAnalyzeQueue,
  enqueueAnalyzeJob,
  getJobStatus,
  waitForJob,
  queueStats,
};
