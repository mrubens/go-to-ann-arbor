// Named colors the model picks from, and the hex each one draws as. Names keep the questions short and the answers
// comparable; `toOsmTags` (record.js) turns them into hex for strictly valid OpenStreetMap tags.

export const WALL = {
  white: '#f2efe7', cream: '#e6dcc0', pale_yellow: '#ead9a0', yellow: '#e4cd85', tan: '#b9a68d',
  light_gray: '#c9cbc8', gray: '#92989a', charcoal: '#565c61', light_blue: '#9fb2c0', blue: '#6f879b',
  navy: '#3f4f5a', sage_green: '#aab595', dark_green: '#46604a', red: '#8b3a2e', burgundy: '#6b2331',
  brown: '#6b5b4b', orange_red: '#b85a3a', buff: '#c98a52'
};

export const ROOF = {
  charcoal: '#45474c', black: '#2b2c2f', gray: '#7a7d80', brown: '#5e4a3c', tan: '#9a8468', green: '#4a5a4b',
  red: '#7d3a30'
};

export const ACCENT = {
  white: '#f4f3ef', cream: '#e6dcc0', black: '#222326', charcoal: '#4a4f54', gray: '#8f9498', burgundy: '#6b2331',
  red: '#c02a1f', navy: '#2b3f5a', blue: '#5b7fa3', dark_green: '#2e4a37', brown: '#5a4534',
  natural_wood: '#8a6a45', yellow: '#d9b23a'
};

export const PALETTES = { WALL, ROOF, ACCENT };

export function hex(palette, name, fallback) {
  return PALETTES[palette][name] || fallback || Object.values(PALETTES[palette])[0];
}
