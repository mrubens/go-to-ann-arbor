// js/ground-lifts.js
// How high the city's ground layers stand over the ground itself. On the city's mesh of triangles (terrain.js) every
// layer is cut along the same triangles, so they can stand their real heights apart: the asphalt on the ground, its
// paint a few millimetres over it, the curb and the sidewalk 15 cm up and the lawns just over the sidewalk's edge.

export const LIFT = { paint: 0.005, curb: 0.15, slab: 0.16, lawn: 0.18, bank: 0.165, over: 0.02 };
