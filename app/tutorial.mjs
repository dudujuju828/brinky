import { setTimeout as wait } from 'node:timers/promises';

// One owner for the tutorial's audio and muted-reading schedule. Late callbacks
// from a stopped lesson can never move a pointer in a newer lesson.
export class TutorialPlayer {
  constructor(voice) { this.voice = voice; this.session = null; }
  play(segments, { speak, onCue, onEnd, onError }) {
    this.stop();
    const session = { controller: new AbortController(), speak, onEnd };
    this.session = session;
    const signal = session.controller.signal;
    const cue = index => {
      if (this.session === session && !signal.aborted) onCue(segments[index], index, segments.length);
    };
    const run = async () => {
      if (speak) await this.voice.speakSequence(segments, { signal, onSegmentStart: cue });
      else for (let index = 0; index < segments.length; index++) {
        signal.throwIfAborted(); cue(index);
        await wait(segments[index].seconds * 1000, undefined, { signal });
      }
    };
    void run().then(() => {
      if (this.session !== session) return;
      this.session = null; onEnd(false);
    }).catch(error => {
      if (this.session !== session) return;
      this.session = null; onEnd(true);
      if (!signal.aborted) onError(error);
    });
  }
  stop() {
    const session = this.session;
    if (!session) return;
    this.session = null; session.controller.abort();
    if (session.speak) this.voice.stopSpeaking();
    session.onEnd(true);
  }
}
