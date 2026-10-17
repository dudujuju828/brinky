// Flow exposes these commands in its desktop protocol handler. Keep them fixed:
// renderer content can neither choose a URL nor launch arbitrary applications.
const START = 'wispr-flow://start-hands-free';
const STOP = 'wispr-flow://stop-hands-free';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export class WisprFlow {
  constructor(openExternal) { this.openExternal = openExternal; this.queue = Promise.resolve(); this.session = null; }
  enqueue(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }
  start(id, canStart) {
    const session = { id, cancelled: false, started: false, dispatchedAt: 0 };
    this.session = session;
    return this.enqueue(async () => {
      if (session.cancelled || !canStart()) return false;
      session.started = true;
      session.dispatchedAt = Date.now();
      await this.openExternal(START);
      // The protocol handler is asynchronous. Serialize stop behind the start
      // dispatch, including a very short key release or a cancelled focus attempt.
      session.dispatchedAt = Date.now();
      return true;
    });
  }
  stop(id) {
    const session = this.session;
    if (!session || session.id !== id) return Promise.resolve(false);
    session.cancelled = true; this.session = null;
    return this.enqueue(async () => {
      if (!session.started) return false;
      await delay(Math.max(0, 600 - (Date.now() - session.dispatchedAt)));
      await this.openExternal(STOP);
      return true;
    });
  }
}
