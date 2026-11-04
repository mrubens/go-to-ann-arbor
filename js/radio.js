// js/radio.js — the car radio: Ann Arbor's own stations, live, while the player drives a car (not on a motorbike).
// Out of a car (on foot, on a bike, in the kayak) the player has their own earbuds on the same dial: off until they
// pick a station, then that one, kept between visits (`phones`); main.js shows white earbuds on them while it plays.
// Each car is tuned to a station of its own (the player's SUV keeps the one they last chose); R or the controller's
// d-pad left and right change it, Off among them. The stream plays in the app around the page (Sources/Native.swift,
// radioPlay, which also reads the song on); in a browser, the page plays it itself in an audio element, without the
// song's title (the streams don't let a page read it).
import { hot, save, load, log, random } from '../lamp-game.js';

const STW = (call) => `https://playerservices.streamtheworld.com/api/livestream-redirect/${call}.mp3`;
const STATIONS = [
  { call: 'WCBN', dial: '88.3', about: 'Student radio, freeform', url: 'https://floyd.wcbn.org:8443/wcbn-mid.mp3' },
  { call: 'WEMU', dial: '89.1', about: 'Jazz, blues and news', url: STW('WEMUFM') },
  { call: 'Michigan Public', dial: '91.7', about: 'NPR news and talk', url: STW('WUOMFM') },
  { call: 'W4 Country', dial: '102.9', about: 'Country', url: STW('WWWWFM') },
  { call: '107one', dial: '107.1', about: 'Adult hits', url: STW('WQKLFM') },
  { call: 'WTKA', dial: '1050 AM', about: 'Michigan sports talk', url: STW('WTKAAM') }
];
const OFF = -1;
const VOLUME = 0.6;

class CarRadio {
  constructor() {
    const saved = load('radio');
    this.own = Number.isInteger(saved?.own) ? saved.own : 0;
    this.phones = Number.isInteger(saved?.phones) ? saved.phones : OFF;
    this.byCar = new Map();
    this.carKey = null;
    this.station = OFF;
    this.playing = OFF;
    this.title = '';
    this.titleAt = 0;
    this.el = document.getElementById('car-radio');
    this.nameEl = document.getElementById('radio-station');
    this.subEl = document.getElementById('radio-now');
    // a stream left on by the code before this one
    this.native?.call('radioStop').catch(() => {});
    if (window.__radioAudio) { window.__radioAudio.pause(); window.__radioAudio.removeAttribute('src'); window.__radioAudio.load(); }
    this.audio = null;
    this.retry = 0;
    document.getElementById('radio-prev')?.addEventListener('click', () => this.tune(-1));
    document.getElementById('radio-next')?.addEventListener('click', () => this.tune(1));
    document.getElementById('radio-current')?.addEventListener('click', () => this.tune(1));
  }

  get native() { return window.LampNative?.available ? window.LampNative : null; }

  // the station a car comes tuned to: the SUV the player's choice, any other car one of its own, kept while in town
  stationFor(key, own) {
    if (key === 'phones') return this.phones;
    if (own) return this.own;
    if (!this.byCar.has(key)) this.byCar.set(key, Math.floor(random() * STATIONS.length));
    return this.byCar.get(key);
  }

  tune(dir) {
    if (!this.carKey) return;
    const n = STATIONS.length + 1;
    this.station = ((this.station + 1 + dir) % n + n) % n - 1;
    if (this.carKey === 'own') this.own = this.station;
    else if (this.carKey === 'phones') this.phones = this.station;
    if (this.carKey === 'own' || this.carKey === 'phones') save('radio', { own: this.own, phones: this.phones });
    else this.byCar.set(this.carKey, this.station);
    log(`[radio] tuned to ${this.station === OFF ? 'off' : STATIONS[this.station].call}`);
    this.draw();
  }

  // each frame: in a car with sound on, its station plays; out of one, the earbuds' (in the helicopter, nothing).
  // The app is asked only on a change.
  update(dt, { inCar, carKey, own, phones, soundOn }) {
    const key = inCar ? (own ? 'own' : carKey) : phones ? 'phones' : null;
    if (key !== this.carKey) {
      this.carKey = key;
      if (key) this.station = this.stationFor(key, own);
      this.draw();
    }
    const want = key && soundOn && !document.hidden ? this.station : OFF;
    if (want !== this.playing) {
      this.playing = want;
      this.title = '';
      const native = this.native;
      if (native) {
        if (want === OFF) native.call('radioStop').catch(() => {});
        else native.call('radioPlay', { url: STATIONS[want].url, volume: VOLUME })
          .catch((e) => log(`[radio] ${STATIONS[want].call} would not play: ${e?.message || e}`));
      } else this.webPlay(want);
      this.draw();
    }
    // in a browser, a stream that dropped or wouldn't start tries again every few seconds
    if (!this.native && this.playing !== OFF && this.audio && (this.audio.error || this.audio.ended || this.failed)) {
      if ((this.retry -= dt) <= 0) { this.retry = 5; this.webPlay(this.playing); }
    }
    // the song on now, asked every few seconds while a station plays
    this.titleAt -= dt;
    if (this.playing !== OFF && this.titleAt <= 0 && this.native) {
      this.titleAt = 5;
      this.native.call('radioNow').then((t) => {
        const text = typeof t === 'string' ? t.replace(/^\s*-\s*$/, '') : '';
        if (text !== this.title) { this.title = text; this.draw(); }
      }).catch(() => {});
    }
  }

  // the browser's own player: one audio element for the page, streaming the station straight from it
  webPlay(want) {
    let a = this.audio;
    if (!a) {
      a = this.audio = window.__radioAudio || (window.__radioAudio = new Audio());
      a.preload = 'none';
      a.addEventListener('playing', () => { this.failed = false; });
    }
    if (want === OFF) { a.pause(); a.removeAttribute('src'); a.load(); this.failed = false; return; }
    a.src = STATIONS[want].url;
    a.volume = VOLUME;
    this.failed = false;
    a.play().catch((e) => {
      // a browser that wants a click on the page first, or a station that's down: tried again shortly
      this.failed = true;
      log(`[radio] ${STATIONS[want].call} would not play in the browser: ${e?.name || e}`);
    });
  }

  draw() {
    if (!this.el) return;
    this.el.hidden = !this.carKey;
    if (!this.carKey) return;
    const s = STATIONS[this.station];
    const phones = this.carKey === 'phones';
    this.nameEl.textContent = s ? `${s.dial} ${s.call}` : phones ? 'Earbuds off' : 'Radio off';
    this.subEl.textContent = !s ? 'Ann Arbor stations' : this.title || s.about;
    this.el.classList.toggle('is-phones', phones);
    const icon = this.el.querySelector('#radio-current use');
    icon?.setAttribute('href', phones ? '#i-earbuds' : '#i-radio');
    this.el.classList.toggle('is-off', !s);
  }

  // the player's earbuds are in and playing
  get earbuds() { return this.carKey === 'phones' && this.phones !== OFF; }

  stop() {
    this.playing = OFF;
    this.native?.call('radioStop').catch(() => {});
    if (this.audio) this.webPlay(OFF);
  }
}

// Lamp: a change here goes into the running city (lamp-game.js, "Changes while it's played")
hot(import.meta).accept();

export { CarRadio };
