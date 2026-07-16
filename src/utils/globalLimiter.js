let activeRequests = 0;
const waitingQueue = [];

const MAX_CONCURRENT = parseInt(process.env.GLOBAL_MAX_CONCURRENT || '200', 10);
const MAX_QUEUE_SIZE = parseInt(process.env.GLOBAL_MAX_QUEUE || '500', 10);
const MAX_WAIT_MS = parseInt(process.env.GLOBAL_MAX_WAIT_MS || '30000', 10);

function capacityPayload(retryAfterSeconds = 3) {
  return {
    error: 'High demand right now. Please try again in a moment.',
    retryable: true,
    retryAfterSeconds,
  };
}

function releaseSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
  drainQueue();
}

function drainQueue() {
  while (activeRequests < MAX_CONCURRENT && waitingQueue.length > 0) {
    const item = waitingQueue.shift();
    if (!item || item.cancelled) continue;
    clearTimeout(item.timer);
    admit(item.req, item.res, item.next);
  }
}

function admit(req, res, next) {
  activeRequests++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseSlot();
  };
  res.on('finish', release);
  res.on('close', release);
  next();
}

function enqueue(req, res, next) {
  if (waitingQueue.length >= MAX_QUEUE_SIZE) {
    return res.status(503).json(capacityPayload(3));
  }

  const item = {
    req,
    res,
    next,
    cancelled: false,
    timer: null,
  };

  item.timer = setTimeout(() => {
    if (item.cancelled) return;
    item.cancelled = true;
    const idx = waitingQueue.indexOf(item);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    if (!res.headersSent) {
      res.status(503).json(capacityPayload(3));
    }
  }, MAX_WAIT_MS);

  const onClose = () => {
    if (item.cancelled) return;
    // Still waiting — client disconnected
    if (waitingQueue.includes(item)) {
      item.cancelled = true;
      clearTimeout(item.timer);
      const idx = waitingQueue.indexOf(item);
      if (idx !== -1) waitingQueue.splice(idx, 1);
    }
  };
  res.on('close', onClose);

  waitingQueue.push(item);
}

function globalLimiter(req, res, next) {
  if (activeRequests < MAX_CONCURRENT) {
    admit(req, res, next);
    return;
  }
  enqueue(req, res, next);
}

function getActiveCount() {
  return activeRequests;
}

function getLimiterStats() {
  return {
    active: activeRequests,
    waiting: waitingQueue.length,
    maxConcurrent: MAX_CONCURRENT,
    maxQueue: MAX_QUEUE_SIZE,
    maxWaitMs: MAX_WAIT_MS,
  };
}

module.exports = { globalLimiter, getActiveCount, getLimiterStats };
