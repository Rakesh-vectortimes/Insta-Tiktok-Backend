let activeRequests = 0;
const MAX_CONCURRENT = parseInt(process.env.GLOBAL_MAX_CONCURRENT || '200', 10);

function globalLimiter(req, res, next) {
  if (activeRequests >= MAX_CONCURRENT) {
    return res.status(503).json({
      error: 'Server is at capacity. Please try again in a few seconds.',
      retryable: true,
    });
  }

  activeRequests++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeRequests--;
  };
  res.on('finish', release);
  res.on('close', release);
  next();
}

function getActiveCount() {
  return activeRequests;
}

module.exports = { globalLimiter, getActiveCount };
