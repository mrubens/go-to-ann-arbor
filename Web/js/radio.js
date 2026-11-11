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
  { call: '107one', dial: '107.1', about: 'Adult album alternative', url: STW('WQKLFM') },
  { call: 'WTKA', dial: '1050 AM', about: 'Michigan sports talk', url: STW('WTKAAM') }
];
const OFF = -1;
const VOLUME = 0.6;

class CarRadio {
  constructor() {
    const saved = load('radio');
    this.own = Number.isInteger(saved?.own) ? saved.own : 0;
    this.phones = Number.isInteger(saved?.phones) ? saved.phones : OFF;
    // each car's station, kept through a reload of the code and between plays (the 'radio' save)
    this.byCar = new Map(Object.entries(saved?.byCar || {}));
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
    this.lost = false;
    // the station plays on in a hidden tab or a minimized window, as a radio left on in the background does (people
    // keep the page open just to listen). An old listener that stopped it there is taken away
    if (window.__radioHidden) { document.removeEventListener('visibilitychange', window.__radioHidden); window.__radioHidden = null; }
    document.getElementById('radio-prev')?.addEventListener('click', () => this.tune(-1));
    document.getElementById('radio-next')?.addEventListener('click', () => this.tune(1));
    document.getElementById('radio-current')?.addEventListener('click', () => this.tune(1));
    // on a touch screen, the bar's music button opens every station (and Off) to pick from
    this.pop = document.getElementById('radio-popover');
    if (this.pop) {
      const item = (i, name, sub) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pop-item pop-radio';
        b.dataset.station = String(i);
        const n = document.createElement('span'); n.className = 'pop-name'; n.textContent = name;
        const d = document.createElement('span'); d.className = 'pop-sub'; d.textContent = sub;
        b.append(n, d);
        b.addEventListener('click', () => { this.tuneTo(i); this.pop.hidePopover?.(); });
        return b;
      };
      this.popTitle = document.createElement('div');
      this.popTitle.className = 'pop-title';
      this.pop.replaceChildren(this.popTitle, item(OFF, 'Off', 'No music'),
        ...STATIONS.map((st, i) => item(i, `${st.dial} ${st.call}`, st.about)));
    }
  }

  // the stations saved: the player's car, their earbuds, and the last 40 other cars they've sat in
  keep() {
    const byCar = Object.fromEntries([...this.byCar].slice(-40));
    save('radio', { own: this.own, phones: this.phones, byCar });
  }

  tuneTo(station) {
    if (!this.carKey) return;
    this.tune(station - this.station);
  }

  get native() { return window.LampNative?.available ? window.LampNative : null; }

  // the station a car comes tuned to: the SUV the player's choice, any other car one of its own, kept while in town
  stationFor(key, own) {
    if (key === 'phones') return this.phones;
    if (own) return this.own;
    if (!this.byCar.has(key)) { this.byCar.set(key, Math.floor(random() * STATIONS.length)); this.keep(); }
    return this.byCar.get(key);
  }

  tune(dir) {
    if (!this.carKey) return;
    const n = STATIONS.length + 1;
    this.station = ((this.station + 1 + dir) % n + n) % n - 1;
    if (this.carKey === 'own') this.own = this.station;
    else if (this.carKey === 'phones') this.phones = this.station;
    if (this.carKey !== 'own' && this.carKey !== 'phones') this.byCar.set(this.carKey, this.station);
    this.keep();
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
    const want = key && soundOn ? this.station : OFF;
    if (want !== this.playing) {
      this.playing = want;
      this.title = '';
      this.lost = false;
      this.retry = 5;
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
      // (no signal only for a stream that failed, not one waiting for a click on the page)
      if (!this.lost && (this.audio.error || this.audio.ended)) { this.lost = true; this.draw(); }
      if ((this.retry -= dt) <= 0) { this.retry = 5; this.webPlay(this.playing); }
    }
    // in the app, likewise: one that failed or ended (the network gone, the Mac asleep, the station refusing) is
    // started again every few seconds, and the dial says there's no signal meanwhile. The app tells its player's state
    // (radioState: playing, waiting or failed); an app without the call keeps the stream as it is
    if (this.native && this.playing !== OFF && (this.retry -= dt) <= 0) {
      this.retry = 5;
      const asked = this.playing;
      this.native.call('radioState').then((state) => {
        if (asked !== this.playing) return;
        const lost = state === 'failed';
        if (lost !== this.lost) { this.lost = lost; this.draw(); }
        if (lost) this.native?.call('radioPlay', { url: STATIONS[asked].url, volume: VOLUME }).catch(() => {});
      }).catch(() => {});
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
      a.addEventListener('playing', () => { this.failed = false; if (this.lost) { this.lost = false; this.draw(); } });
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
    const cb = document.getElementById('cb-radio');
    if (cb) cb.hidden = !this.carKey;
    if (!this.carKey) return;
    if (cb) {
      const st = STATIONS[this.station];
      cb.querySelector('use')?.setAttribute('href', this.carKey === 'phones' ? '#i-earbuds' : '#i-radio');
      cb.querySelector('#cb-radio-name').textContent = st ? st.dial : 'Off';
      cb.classList.toggle('is-off', !st);
    }
    if (this.popTitle) this.popTitle.textContent = this.carKey === 'phones' ? 'Earbuds' : 'Car radio';
    this.pop?.querySelectorAll('.pop-radio').forEach((b) => b.classList.toggle('active', Number(b.dataset.station) === this.station));
    const s = STATIONS[this.station];
    const phones = this.carKey === 'phones';
    this.nameEl.textContent = s ? `${s.dial} ${s.call}` : phones ? 'Earbuds off' : 'Radio off';
    this.subEl.textContent = !s ? 'Ann Arbor stations' : this.lost ? 'No signal' : this.title || s.about;
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
