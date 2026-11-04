// Recording mode: a video of what the game draws (the 3D view, without the HUD) and plays (the city's sound), made by
// the browser's MediaRecorder and sent a second at a time to the app around the page, which writes it into the Mac's
// Movies/Go To Ann Arbor folder (Native.swift). Where there's no app around it, the video downloads when it stops.
import { log } from '../lamp-game.js';

const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4',
  'video/webm;codecs=vp9,opus', 'video/webm'];

function base64(blob) {
  return new Promise((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

class VideoRecorder {
  constructor(canvas, audioSystem, onState = () => {}) {
    this.canvas = canvas;
    this.audioSystem = audioSystem;
    this.onState = onState;
    this.recorder = null;
    this.seconds = 0;
    this.supported = typeof MediaRecorder !== 'undefined' && !!canvas.captureStream;
  }

  get recording() { return !!this.recorder; }

  async start() {
    if (this.recorder || !this.supported) return;
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const stream = this.canvas.captureStream(60);
    // the city's sound, taken after its final mix
    const a = this.audioSystem;
    if (a?.context && a.master) {
      try {
        this.tap = a.context.createMediaStreamDestination();
        a.master.connect(this.tap);
        this.tapFrom = a.master;
        for (const t of this.tap.stream.getAudioTracks()) stream.addTrack(t);
      } catch (e) { this.tap = null; }
    }
    const native = !!window.LampNative?.available;
    this.ext = type.includes('webm') ? 'webm' : 'mp4';
    this.parts = [];
    this.queue = Promise.resolve();
    this.failed = false;
    if (native) {
      try { this.name = await window.LampNative.call('videoStart', { ext: this.ext }); } catch (e) { this.name = null; }
    }
    this.native = native && !!this.name;
    const rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: 16e6, audioBitsPerSecond: 160e3 });
    rec.ondataavailable = (e) => {
      if (!e.data?.size) return;
      if (!this.native) { this.parts.push(e.data); return; }
      this.queue = this.queue.then(async () => {
        if (this.failed) return;
        try { await window.LampNative.call('videoChunk', { data: await base64(e.data) }); }
        catch (err) { this.failed = true; log('[recording] a part of the video could not be saved'); }
      });
    };
    rec.onstop = () => this.finish();
    this.recorder = rec;
    this.seconds = 0;
    rec.start(1000);
    log(`[recording] started (${type || 'default'}${this.tap ? ', with sound' : ''})`);
    this.onState(true);
  }

  stop() {
    if (!this.recorder) return;
    this.recorder.stop();
    for (const t of this.recorder.stream.getVideoTracks()) t.stop();
  }

  toggle() { return this.recording ? this.stop() : this.start(); }

  async finish() {
    const secs = Math.round(this.seconds);
    this.recorder = null;
    try { if (this.tap) this.tapFrom.disconnect(this.tap); } catch (e) { /* already gone */ }
    this.tap = null;
    let saved = null;
    if (this.native) {
      await this.queue;
      try { saved = await window.LampNative.call('videoEnd'); } catch (e) { saved = null; }
    } else if (this.parts.length) {
      const blob = new Blob(this.parts, { type: this.parts[0].type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Ann Arbor drive.${this.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      saved = a.download;
    }
    this.parts = [];
    log(`[recording] stopped after ${secs} s${saved ? ': saved' : ': not saved'}`);
    this.onState(false, saved, secs);
  }

  // the recording's length, counted from the frames while it runs
  update(dt) { if (this.recorder) this.seconds += dt; }
}

export { VideoRecorder };
