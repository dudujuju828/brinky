import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../native/flow-hold.ps1', import.meta.url)).replace('app.asar', 'app.asar.unpacked');
export class FlowHold {
  constructor(onEvent) { this.onEvent = onEvent; this.ready = false; this.enabled = false; this.retryDelay = 250; }
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
    if (!child) return;
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end('quit:0\n');
    const timeout = setTimeout(() => child.kill(), 1500);
    timeout.unref(); child.once('exit', () => clearTimeout(timeout));
  }
}
