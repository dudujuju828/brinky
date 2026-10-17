import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../native/flow-hold.ps1', import.meta.url)).replace('app.asar', 'app.asar.unpacked');
export class FlowHold {
  constructor(onEvent) {
    this.onEvent = onEvent; this.ready = false; this.enabled = false; this.retryDelay = 250;
    this.wisprSequence = 0; this.wisprRequests = new Map();
  }
  failWisprRequests() {
    for (const request of this.wisprRequests.values()) {
      clearTimeout(request.timer); request.reject(new Error('Wispr command delivery was interrupted.'));
    }
    this.wisprRequests.clear();
  }
  wisprCommand(action) {
    if (!['start', 'stop'].includes(action)) return Promise.reject(new Error('Invalid Wispr command.'));
    if (!this.ready || !this.child || this.child.stdin.destroyed || this.child.stdin.writableEnded) return Promise.resolve(false);
    const id = ++this.wisprSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.wisprRequests.delete(id);
        reject(new Error('Wispr command acknowledgement timed out.'));
      }, 1500);
      this.wisprRequests.set(id, { resolve, reject, timer });
      this.send(`wispr-${action}`, id);
    });
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this.start();
    else this.close();
  }
  start() {
    if (this.child || !this.enabled) return;
    clearTimeout(this.retryTimer);
    const child = spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-OwnerProcessId', String(process.pid), '-SequenceBase', String(Date.now() * 1000)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.ready = false;
    const started = Date.now(); let lastSeen = started, buffer = '';
    const ended = () => {
      if (this.child !== child) return;
      clearInterval(this.watchdog); this.watchdog = undefined;
      this.child = undefined; this.ready = false;
      this.failWisprRequests();
      child.kill();
      this.onEvent({ type: 'unavailable' });
      if (this.enabled) {
        if (Date.now() - started > 30000) this.retryDelay = 250;
        this.retryTimer = setTimeout(() => this.start(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 5000);
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      if (this.child !== child) return;
      buffer += data;
      if (buffer.length > 65536) { ended(); return; }
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        lastSeen = Date.now();
        if (event.type === 'alive') continue;
        if (typeof event.type === 'string' && event.type.startsWith('wispr-')) {
          const request = this.wisprRequests.get(event.id);
          if (request) {
            clearTimeout(request.timer); this.wisprRequests.delete(event.id);
            if (event.type === 'wispr-accepted') request.resolve(true);
            else if (event.type === 'wispr-unavailable') request.resolve(false);
            else request.reject(new Error('Wispr did not acknowledge the command.'));
          }
          continue;
        }
        if (event.type === 'unavailable') { ended(); return; }
        if (event.type === 'ready') this.ready = true;
        this.onEvent(event);
      }
    });
    child.stderr.resume();
    child.stdin.on('error', ended);
    child.on('error', ended); child.on('exit', ended);
    // Covers both a process that exits and a live helper whose message loop stalls.
    this.watchdog = setInterval(() => { if (Date.now() - lastSeen > (this.ready ? 6000 : 15000)) ended(); }, 1000);
  }
  send(action, value) {
    const child = this.child;
    if (child && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(`${action}:${value}\n`);
  }
  close() {
    this.enabled = false;
    clearTimeout(this.retryTimer); clearInterval(this.watchdog);
    const child = this.child;
    this.child = undefined; this.ready = false;
    this.failWisprRequests();
    if (!child) return;
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end('quit:0\n');
    const timeout = setTimeout(() => child.kill(), 1500);
    timeout.unref(); child.once('exit', () => clearTimeout(timeout));
  }
}
