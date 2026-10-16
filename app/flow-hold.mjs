import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../native/flow-hold.ps1', import.meta.url)).replace('app.asar', 'app.asar.unpacked');
export class FlowHold {
  constructor(onEvent) { this.onEvent = onEvent; this.ready = false; }
  start() {
    if (this.child) return;
    const child = spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      buffer += data;
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'ready') this.ready = true;
        this.onEvent(event);
      }
    });
    child.stderr.resume(); child.stdin.on('error', () => {});
    const ended = () => {
      if (this.child !== child) return;
      this.child = undefined; this.ready = false; this.onEvent({ type: 'unavailable' });
    };
    child.on('error', ended); child.on('exit', ended);
  }
  send(action, id) { this.child?.stdin.write(`${action}:${id}\n`); }
  close() {
    // Closing stdin lets the observer remove its keyboard hook before it exits.
    this.child?.stdin.end('quit:0\n'); this.child = undefined; this.ready = false;
  }
}
