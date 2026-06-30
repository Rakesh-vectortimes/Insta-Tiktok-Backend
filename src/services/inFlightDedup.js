const inFlight = new Map();

function dedupedRun(key, fn) {
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

function inFlightStats() {
  return { pending: inFlight.size };
}

module.exports = { dedupedRun, inFlightStats };
