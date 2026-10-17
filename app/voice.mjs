import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { answerCharacterLimit } from './guidance.mjs';
const helper = fileURLToPath(new URL('../native/speech.ps1', import.meta.url)).replace('app.asar', 'app.asar.unpacked');
const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function launch(mode, onEvent) {
  const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Mode', mode], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    for (;;) {
      const end = buffer.indexOf('\n');
      if (end < 0) break;
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      try { if (line) onEvent(JSON.parse(line)); } catch { /* Ignore nonprotocol output. */ }
    }
  });
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.on('error', () => onEvent({ type: 'error', message: 'Windows speech could not start. You can still type your question.' }));
  return child;
}

export class Voice {
  constructor(onEvent, options = {}) {
    this.onEvent = onEvent;
    this.options = options;
    this.audioCache = new Map();
    this.cacheBytes = 0;
  }
  listen() {
    this.cancel();
    let completed = false;
    const child = launch('listen', event => {
      if (this.listener !== child) return;
      if (event.type === 'done' || event.type === 'error') completed = true;
      this.onEvent(event);
    });
    this.listener = child;
    child.on('exit', () => {
      if (this.listener !== child) return;
      this.listener = undefined;
      if (!completed) this.onEvent({ type: 'error', message: 'Speech input ended unexpectedly. Please check your microphone or type instead.' });
    });
  }
  finish() { this.listener?.stdin.write('stop\n'); }
  cancel() { const old = this.listener; this.listener = undefined; old?.kill(); this.stopSpeaking(); }
  speak(text, { extendedAnswers = false } = {}) {
    this.stopSpeaking();
    text = text.slice(0, answerCharacterLimit(extendedAnswers));
    if (this.options.getProvider?.() === 'elevenlabs') {
      void this.speakElevenLabs(text);
      return;
    }
    this.speakWindows(text);
  }
  speakWindows(text) {
    const child = launch('speak', () => {});
    this.speaker = child;
    child.stdin.end(JSON.stringify({ text }) + '\n');
    child.on('exit', () => { if (this.speaker === child) this.speaker = undefined; });
  }
  async speakElevenLabs(text) {
    const controller = new AbortController();
    this.request = controller;
    try {
      let audio = this.audioCache.get(text);
      if (!audio) {
        const key = await this.options.getElevenLabsKey();
        controller.signal.throwIfAborted();
        if (!key) throw new Error('Voice key unavailable.');
        const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=pcm_24000', {
          method: 'POST', redirect: 'error',
          headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/pcm' },
          body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 } }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(text.length > 1800 ? 90000 : 45000)]),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Voice service unavailable.'); }
        const pcm = Buffer.from(await response.arrayBuffer());
        controller.signal.throwIfAborted();
        if (!pcm.length || pcm.length % 2 || pcm.length > (text.length > 1800 ? 24 : 12) * 1024 * 1024) throw new Error('Unexpected audio response.');
        // ElevenLabs PCM is mono, signed 16-bit little endian. SoundPlayer accepts a WAV container.
        const header = Buffer.alloc(44);
        header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
        header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
        header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
        header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
        audio = Buffer.concat([header, pcm]);
        while (this.audioCache.size && (this.audioCache.size >= 8 || this.cacheBytes + audio.length > 24 * 1024 * 1024)) {
          const oldest = this.audioCache.keys().next().value;
          this.cacheBytes -= this.audioCache.get(oldest).length; this.audioCache.delete(oldest);
        }
        if (audio.length <= 24 * 1024 * 1024) { this.audioCache.set(text, audio); this.cacheBytes += audio.length; }
      }
      if (this.request !== controller || controller.signal.aborted) return;
      let failed = false;
      const child = launch('play', () => {
        if (this.speaker !== child || failed) return;
        failed = true;
        this.onEvent({ type: 'playback-error', message: 'Audio playback was unavailable. Using Windows voice for this reply.' });
        this.speakWindows(text);
      });
      this.speaker = child;
      child.stdin.end(JSON.stringify({ audio: audio.toString('base64') }) + '\n');
      child.on('exit', () => { if (this.speaker === child) this.speaker = undefined; });
    } catch {
      if (this.request !== controller || controller.signal.aborted) return;
      this.onEvent({ type: 'playback-error', message: 'ElevenLabs is unavailable right now. Using Windows voice for this reply. You can choose Windows voice in Connection → Reply voice.' });
      this.speakWindows(text);
    } finally { if (this.request === controller) this.request = undefined; }
  }
  stopSpeaking() {
    this.request?.abort(); this.request = undefined;
    const old = this.speaker; this.speaker = undefined; old?.kill();
  }
}
