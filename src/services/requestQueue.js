class RequestQueue {
  constructor(concurrency = 8) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._next();
    });
  }

  _next() {
    if (this.running >= this.concurrency) return;
    const item = this.queue.shift();
    if (!item) return;

    this.running++;
    item.task()
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        this.running--;
        this._next();
      });
  }

  stats() {
    return { running: this.running, queued: this.queue.length, concurrency: this.concurrency };
  }
}

const downloadQueue = new RequestQueue(8);
const sessionQueue = new RequestQueue(3);

module.exports = { downloadQueue, sessionQueue, RequestQueue };
