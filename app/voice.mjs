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
  async prepareAudio(text, signal) {
      let audio = this.audioCache.get(text);
      if (!audio) {
        const key = await this.options.getElevenLabsKey();
        signal.throwIfAborted();
        if (!key) throw new Error('Voice key unavailable.');
        const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=pcm_24000', {
          method: 'POST', redirect: 'error',
          headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/pcm' },
          body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 } }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(text.length > 1800 ? 90000 : 45000)]),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Voice service unavailable.'); }
        const pcm = Buffer.from(await response.arrayBuffer());
        signal.throwIfAborted();
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
      signal.throwIfAborted();
      return audio;
  }
  async speakElevenLabs(text) {
    const controller = new AbortController();
    this.request = controller;
    try {
      const audio = await this.prepareAudio(text, controller.signal);
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
  async speakSequence(segments, { signal: parentSignal, onSegmentStart }) {
    this.stopSpeaking();
    const controller = new AbortController(); this.sequenceController = controller;
    const signal = AbortSignal.any([parentSignal, controller.signal]);
    signal.throwIfAborted();
    let pending, readyResolve, readyReject, readyTimer, fatalError;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const fail = error => {
      fatalError = error;
      readyReject(error);
      if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined; }
    };
    const child = launch('narrate', event => {
      if (signal.aborted) return;
      if (event.type === 'narration-ready') { clearTimeout(readyTimer); readyResolve(); return; }
      if (event.type === 'error') { fail(new Error('Tutorial voice could not start.')); return; }
      if (!pending || event.index !== pending.index) return;
      if (event.type === 'segment-started') {
        try { onSegmentStart(event.index); } catch (error) { fail(error); }
      } else if (event.type === 'segment-finished' || event.type === 'segment-error') {
        const part = pending; pending = undefined; clearTimeout(part.timer);
        if (event.type === 'segment-finished') part.resolve();
        else part.reject(Object.assign(new Error('Tutorial audio playback failed.'), { playbackFailed: true }));
      }
    });
    this.speaker = child;
    child.on('exit', () => fail(new Error('Tutorial voice stopped before completing the explanation.')));
    child.stdin.on('error', () => fail(new Error('Tutorial voice is unavailable.')));
    const abort = () => { fail(new Error('Tutorial cancelled.')); child.kill(); };
    signal.addEventListener('abort', abort, { once: true });
    readyTimer = setTimeout(() => fail(new Error('Tutorial voice took too long to start.')), 15000);
    const play = (index, payload) => new Promise((resolve, reject) => {
      signal.throwIfAborted();
      if (fatalError) throw fatalError;
      const timer = setTimeout(() => fail(new Error('Tutorial section took too long to finish.')), 180000);
      pending = { index, resolve, reject, timer };
      child.stdin.write(JSON.stringify({ index, ...payload }) + '\n', error => { if (error) fail(error); });
    });
    const prepare = text => this.prepareAudio(text, signal).then(audio => ({ audio }), error => ({ error }));
    let natural = this.options.getProvider?.() === 'elevenlabs';
    let nextAudio = natural && segments.length ? prepare(segments[0].text) : null;
    const fallback = () => {
      natural = false;
      this.onEvent({ type: 'playback-error', message: 'Natural voice is unavailable for this tutorial. Continuing with Windows voice.' });
    };
    try {
      await ready;
      for (let index = 0; index < segments.length; index++) {
        signal.throwIfAborted();
        let audio;
        if (natural) {
          const prepared = await nextAudio; signal.throwIfAborted();
          if (prepared.error) fallback();
          else {
            audio = prepared.audio;
            // Fetch only one section ahead while the current section plays.
            nextAudio = index + 1 < segments.length ? prepare(segments[index + 1].text) : null;
          }
        }
        if (audio) {
          try { await play(index, { audio: audio.toString('base64') }); }
          catch (error) { signal.throwIfAborted(); if (!error.playbackFailed) throw error; fallback(); await play(index, { text: segments[index].text }); }
        } else await play(index, { text: segments[index].text });
      }
    } finally {
      signal.removeEventListener('abort', abort); clearTimeout(readyTimer);
      if (pending) clearTimeout(pending.timer);
      controller.abort(); child.stdin.end(); child.kill();
      if (this.speaker === child) this.speaker = undefined;
      if (this.sequenceController === controller) this.sequenceController = undefined;
    }
  }
  stopSpeaking() {
    this.sequenceController?.abort(); this.sequenceController = undefined;
    this.request?.abort(); this.request = undefined;
    const old = this.speaker; this.speaker = undefined; old?.kill();
  }
}
