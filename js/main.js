// Lamp's game runtime first: in Lamp's preview it sets the clock and random numbers before anything reads them.
import { game, hot, save, load, log, asset, input, onInput, label, glyph, pendingRestore, rumble, BUTTON, STICK, TRIGGER } from '../lamp-game.js';
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, vec3, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from './post-processing.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { CarRadio } from './radio.js';
import { CAR_RATIOS, newGearState, shiftGear, engineRPM } from './gearbox.js';
import { getLocationLabel, isTypingInField, ROADS, LANDMARKS, TELEPORT_LOCATIONS } from './city-config.js';
import { buildKayakLaunches } from './kayak-launches.js';
import { buildLivery } from './gallup-livery.js';
import { buildCityGrid, restoreCityGrid } from './city-grid.js';
import { buildOutskirts } from './outskirts.js';
import { buildLandmarks } from './landmarks.js';
import { buildRailways } from './railways.js';
import { buildParkedCars } from './parked-cars.js';
import { buildCityBlocks } from './buildings.js';
import { setDistricts } from './districts.js';
import { setRoofShapes, setBuildingLooks } from './houses.js';
import { buildStreetDetails } from './street-details.js';
import { createTrafficSystem, createHighwayTraffic } from './traffic.js';
import { loadCityClosures } from './city-closures.js';
import { buildRoadPaint } from './road-paint.js';
import { buildTrafficControls } from './traffic-controls.js';
import { buildShopSigns } from './shop-signs.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { reportMemory, memoryCheckpoint, MEASURE_MEMORY } from './memory-report.js';
import { gpuOnly, releaseUploaded, useRenderer } from './gpu-only.js';
import { TIER } from './device-tier.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem, sunTimes } from './lighting.js';
import { createKnockdowns } from './knockdowns.js';
import { createHydrantSpray } from './hydrant-spray.js';
import { createWaterSplash } from './water-splash.js';
import { createSkidEffects } from './skid-effects.js';
import { CityMapSystem } from './city-map.js';
import { setupSceneCulling, updateSceneCulling, cullAlso, showShadowStandIns } from './scene-culling.js';
import { loadTerrain, setPools, setOnTerrain, groundHeight, waterLevel, riverDepth, streamGround, updateGroundStreaming, streamNear } from './terrain.js';
import { loadYardData, allYards } from './yards.js';
import { buildCascades, CASCADE_START } from './cascades.js';
import { buildRiverPeople } from './river-people.js';
import { buildAnimals } from './animals.js';
import { buildCube, CUBE_FOOTPRINT } from './the-cube.js';
import { buildBandShell } from './band-shell.js';
import { buildRestrooms } from './restrooms.js';
import { createSeats } from './seats.js';
import { CityAudioSystem } from './audio-system.js';
import { fetchWeather, createPrecipitation } from './weather.js';
import { fetchRiverFlow } from './river-gauge.js';
import { fetchRiverPfas } from './river-pfas.js';
import { createPlanes } from './planes.js';
import { createAirport } from './airport.js';
import { createScooters } from './scooters.js';
import { buildBikeRacks } from './bike-racks.js';
import { buildPools } from './pools.js';
import { buildOutdoorSeating } from './outdoor-seating.js';
import { buildBallDiamonds } from './ball-diamonds.js';
import { buildBleachers } from './bleachers.js';
import { buildBoatDocks } from './boat-docks.js';
import { buildSkatePark } from './skate-park.js';
import { buildParkingStructures } from './parking-structures.js';
import { buildMtbTrails } from './mtb-trails.js';
import { dressForSnow, loadSnowCover } from './snow-cover.js';
import { createMoon } from './moon.js';
import { waterDisturb } from './tsl-materials.js';
import { buildRoadWork } from './road-work.js';
import { buildPotholes } from './potholes.js';
import { VideoRecorder } from './recorder.js';

// In its own window on the Mac the top strip is the title bar, which takes the clicks: the top panels sit below it
if (window.webkit?.messageHandlers?.lampNative && /Mac/.test(navigator.platform) && navigator.maxTouchPoints === 0) document.documentElement.classList.add('mac-window');

// Application setup, shader warm-up and frame loop.
//
// Lamp: a change that can't be swapped into the running city runs this file's code again in place (lamp-game.js,
// "Running the game's code again"). What's slow to make is kept through that with live.keep: the renderer and its
// compiled shaders, the ground's heights (terrain.js) and each part of the city, which is built again only when its own
// code, the map data it's built from (its `from`: CITY_MAP and the rest below) or a part it's built from (its
// `inputs`) changed, the rest of the city kept as it is. The scene, the camera and the lights are kept too: three.js
// works out how to draw every object anew for a new one of them, which held the game still for a second at each change.
// Everything else here (the HUD, the controllers, the sound) is made again from the page as it is now.
const live = hot(import.meta);

// The generated data each part of the city is built from (its keep's `from`): a change to one, a street's lanes added to
// the map or new tree points, builds those parts again in place.
const CITY_MAP = 'js/city-geodata.js';
const BUILDING_DATA = ['js/building-geodata.js', 'js/building-geodata.bin.gz'];
const TREE_DATA = ['js/tree-geodata.js', 'js/tree-geodata.bin.gz', 'js/tree-placements.js'];

async function initApp() {
  const container = document.getElementById('canvas-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingTrack = loadingOverlay ? loadingOverlay.querySelector('.loader-track') : null;
  const loadingFill = document.getElementById('loading-progress');
  // Only shader compilation has measurable progress; other stages use the sweeping bar.
  const setLoadingProgress = (p) => {
    if (!loadingFill) return;
    if (loadingTrack) loadingTrack.classList.remove('is-indeterminate');
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };

  // Lamp: a start with the renderer kept (see the top of this file) shows no loading screen and doesn't wait for it
  let warmStart = false;
  async function showLoadingStage(message) {
    if (loadingStatus) loadingStatus.textContent = message;
    if (loadingTrack) loadingTrack.classList.add('is-indeterminate');
    if (document.hidden || warmStart) return;
    // Let the label paint before synchronous work. The timeout also lets hidden tabs keep loading.
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 100);
      requestAnimationFrame(() => {
        clearTimeout(timeout);
        setTimeout(resolve, 0);
      });
    });
  }

  await showLoadingStage('Initializing graphics...');

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer
  // Lamp: what a Mac draws. WebKit compiles the WebGPU path's shaders for 20-50 s before the first frame, and the
  // WebGL 2 one in a few, so it draws with WebGL 2. The clustered street, shop and car lights and the reflections
  // add ~8 s more to the start and are left off. Lamp's runtime draws it at 1920x1080 wherever it's played.
  // On a phone or tablet (device-tier.js) it draws without shadows or the glow, smaller, and builds less of the city.
  const QUALITY = {
    tier: TIER.name,
    phone: TIER.name === 'phone',
    antialias: TIER.antialias,
    shadows: TIER.shadows,
    streetLights: false,
    reflections: false,
    bloom: TIER.bloom,
    outskirts: TIER.outskirts
  };
  // Kept through a change: a new one would compile every shader again.
  const renderer = await live.keep('renderer', async () => {
    const made = new THREE.WebGPURenderer({ antialias: QUALITY.antialias, powerPreference: 'high-performance', reversedDepthBuffer: true, forceWebGL: true });
    await made.init();
    return made;
  });
  useRenderer(renderer);
  // Lamp's runtime draws it at 1920x1080 and fits that to the window (game() below).
  renderer.shadowMap.enabled = QUALITY.shadows;
  if (QUALITY.streetLights) renderer.lighting = new ClusteredLighting(256, 32, 28, 48);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  // with ?memory in the address, each stage of the start logs what the city holds then (memory-report.js), to find the start's peak
  let scene = null;
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    if (MEASURE_MEMORY && scene) memoryCheckpoint(label, scene, renderer, log);
    initMark = performance.now();
  };

  // Whether this renderer has compiled the city's shaders already: kept with it, so the code running again for a change
  // starts without the loading screen, the shader pass or the warm-up frame (what's new compiles as it's first drawn).
  const warm = live.keep('warm', () => ({ compiled: false }), { inputs: [renderer] });
  warmStart = warm.compiled;
  if (warmStart && loadingOverlay) {
    loadingOverlay.style.transition = 'none';
    loadingOverlay.classList.add('hidden');
  }
  markInit('renderer');

  // 2. Scene, atmosphere and lighting
  await showLoadingStage('Creating sky and environment lighting...');
  scene = live.keep('scene', () => new THREE.Scene());
  // What the run before put in the scene goes first, so the lights built here own only what they add: each part of the
  // city comes back below, and the rest is made again.
  scene.clear();
  scene.matrixWorldAutoUpdate = true;
  const lighting = live.keep('lighting', () => {
    const made = new LightingSystem(scene, renderer);
    const own = [...scene.children];
    return { made, own, dispose() { made.release(); for (const object of own) object.removeFromParent(); } };
  }, { inputs: [scene, renderer] });
  scene.add(...lighting.own);
  const lightingSystem = lighting.made;
  const precipitation = createPrecipitation(); // rain & snow (weather.js)
  scene.add(precipitation.mesh);
  markInit('lighting');

  // Lamp: the ground's real heights, which everything below is set on (terrain.js)
  await showLoadingStage('Reading the ground\'s heights...');
  const heights = await loadTerrain();
  markInit('terrain');
  // On a phone, or a Mac without much memory (device-tier.js), the ground is built only around where the player starts
  // and filled in as they go (the frame below): where the last play left them, else the car's start on Main St
  {
    const saved = load('player');
    const at = (saved?.version === 2 && saved.entities?.[saved.activeMode]) || { x: -23, z: 228 };
    streamGround(TIER.stream, Number.isFinite(at.x) ? at.x : -23, Number.isFinite(at.z) ? at.z : 228);
  }
  // 3. Build Ann Arbor's Geography, Landmarks, Blocks, Street Details & Traffic
  // Lamp: each part of the city is built into a group of its own, set on the ground and cut for culling there
  // (cityPart), and kept through a change that isn't its own (see the top of this file): `inputs` are what it's built
  // from, so a part built again builds again the parts made from it. Each part's time is in the "[init]" line.
  // `cull` is setupSceneCulling, named in each part's build so a change to the culling builds the culled parts again.
  // A `still` part never changes once built: its meshes keep their vertex data on the GPU only (gpu-only.js).
  function cityPart(build, { cull = null, still = false } = {}) {
    const group = new THREE.Group();
    const made = build(group);
    // A part that waits for its ground layers (terrain.js) is put together once they're in
    if (made instanceof Promise) return made.then((m) => finishPart(group, m, cull, still));
    return finishPart(group, made, cull, still);
  }
  function finishPart(group, made, cull, still) {
    // Island-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
    // (scene-culling.js)
    const culled = cull ? cull(group, [group], QUALITY.shadows) : []; // no stand-ins without shadows
    if (still) gpuOnly(group);
    return {
      group, made, culled,
      dispose() {
        group.removeFromParent();
        group.traverse((o) => { o.geometry?.dispose(); for (const m of [o.material].flat()) m?.dispose?.(); });
      }
    };
  }
  await showLoadingStage('Building streets, parks and the Huron River...');
  // Lamp: the yards, woods and curb cuts, read from their own files (yards.js): where the city streams, the yards'
  // squares are read only as the player comes near; built whole, every square now
  await loadYardData();
  const grid = await live.keep('grid', () => cityPart(async (g) => {
    const made = buildCityGrid(g, TIER.stream ? null : await allYards());
    // Lamp: the street level built flat at y = 0, set on the ground (cut on several cores the first time, then read
    // back from what that start saved: terrain.js), and the yards near the player when they stream
    await Promise.all([setOnTerrain(g.getObjectByName('CityGrid')), streamNear(made.yardLayers)]);
    return made;
  }, { cull: setupSceneCulling, still: true }), { inputs: [heights], from: [CITY_MAP, 'js/cascades.js', 'js/river.js', 'js/tsl-materials.js', 'js/playgrounds.js',
    'js/yards.js', 'data/yards/index.json', 'data/woods.bin.gz', 'data/curb-cuts.bin.gz'] });
  const cityGrid = grid.made;
  restoreCityGrid(cityGrid.shared);
  markInit('cityGrid');
  // Lamp: the Argo Cascades' rocks and white water, on the steps of their water (cascades.js)
  const cascadesPart = live.keep('cascades', () => cityPart((g) => buildCascades(g, waterLevel)), { inputs: [heights, grid] });
  // Lamp: kayakers and tubers on their way down the river from the cascades (river-people.js)
  const riverPeoplePart = live.keep('riverPeople', () => cityPart((g) => buildRiverPeople(g)), { inputs: [heights, grid], from: ['js/river-people.js'] });
  // the real aircraft overhead (planes.js)
  const planesPart = live.keep('planes', () => cityPart((g) => createPlanes(g)), { from: ['js/planes.js', 'js/live-feeds.js'] });
  // the rental scooters where they really stand (scooters.js)
  const scootersPart = live.keep('scooters', () => cityPart((g) => createScooters(g)), { inputs: [heights], from: ['js/scooters.js', 'js/live-feeds.js', 'data/scooters-sample.json'] });
  // the bike racks round town with bicycles locked to them, and the e-bike docks by the Diag, to borrow from (bike-racks.js)
  const racksPart = await live.keep('bikeRacks', () => cityPart((g) => buildBikeRacks(g)), { inputs: [heights], from: ['js/bike-racks.js', 'data/bike-racks.json'] });
  // the town's outdoor swimming pools, to swim in, and to sink a car in (pools.js); their water is the river's kind
  const poolsPart = await live.keep('pools', () => cityPart((g) => buildPools(g)), { inputs: [heights], from: ['js/pools.js', 'data/pools.json'] });
  setPools(poolsPart.made);
  // the tables and chairs out on the patios and the sidewalks in front of the cafes, restaurants and bars (outdoor-seating.js)
  const seatingPart = await live.keep('outdoorSeating', () => cityPart((g) => buildOutdoorSeating(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/outdoor-seating.js', 'data/outdoor-seating.json'] });
  // the baseball and softball diamonds in the parks and at the schools (ball-diamonds.js)
  const diamondsPart = await live.keep('ballDiamonds', () => cityPart((g) => buildBallDiamonds(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/ball-diamonds.js', 'data/ball-diamonds.json'] });
  // the bleachers by the fields and tracks (bleachers.js)
  const bleachersPart = await live.keep('bleachers', () => cityPart((g) => buildBleachers(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/bleachers.js', 'data/bleachers.json'] });
  // the docks and boat launches on the river and its ponds, with boats tied up (boat-docks.js)
  const docksPart = await live.keep('boatDocks', () => cityPart((g) => buildBoatDocks(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/boat-docks.js', 'data/boat-docks.json'] });
  // the Ann Arbor Skatepark in Veterans Memorial Park (skate-park.js)
  const skatePart = await live.keep('skatePark', () => cityPart((g) => buildSkatePark(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/skate-park.js', 'data/skate-park.json'] });
  // what's on the mountain bike trails: rocks, roots, logs, berms, tabletops and trail posts (mtb-trails.js)
  const mtbPart = await live.keep('mtbTrails', () => cityPart((g) => buildMtbTrails(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/mtb-trails.js', 'data/mtb-trails.json'] });
  // Ann Arbor Municipal Airport south of town, with helicopters parked by the FBO to fly (airport.js)
  const airportPart = live.keep('airport', () => cityPart((g) => createAirport(g)), { inputs: [heights], from: ['js/airport.js', 'js/airport-data.js'] });
  // Lamp: the moon in its real phase (moon.js)
  const moonPart = live.keep('moon', () => cityPart((g) => createMoon(g)), { from: ['js/moon.js'] });
  await showLoadingStage('Laying out the hills of Washtenaw County...');
  const outskirtsPart = live.keep('outskirts', () => cityPart((g) => buildOutskirts(g), { cull: setupSceneCulling, still: true }),
    { inputs: [heights, grid], from: ['js/outskirts.js'] });
  const outskirts = outskirtsPart.made;
  markInit('outskirts');
  await showLoadingStage('Building the Big House...');
  const landmarks = live.keep('landmarks', () => cityPart((g) => buildLandmarks(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: [CITY_MAP, 'js/stadium-geodata.js', 'js/campus-landmarks.js'] });
  // the parking structures, to drive up floor by floor; they stand in for the survey's blocks (parking-structures.js)
  const parkingPart = await live.keep('parkingStructures', () => cityPart((g) => buildParkingStructures(g), { cull: setupSceneCulling, still: true }),
    { inputs: [heights], from: ['js/parking-structures.js', 'data/parking-structures.json'] });
  // the West Park Band Shell, closed and fenced in, in place of the survey's block (band-shell.js)
  const bandShellPart = live.keep('bandShell', () => cityPart((g) => buildBandShell(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/band-shell.js'] });
  // the town's public restrooms and portable toilets, where the map has them (restrooms.js)
  const restroomsPart = await live.keep('restrooms', () => cityPart((g) => buildRestrooms(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/restrooms.js', 'data/restrooms.json'] });
  const landmarkColliders = [...landmarks.made.colliders, ...parkingPart.made.colliders, ...bandShellPart.made.colliders, ...restroomsPart.made.colliders];
  markInit('landmarks');
  await showLoadingStage('Generating building footprints and facades...');
  // house numbers by the front doors (build-addresses.py, the city's Address Points)
  // the city's land use and historic districts (build-districts.py): building looks and the location label ask them
  const districtBytes = await asset('data/districts.json');
  setDistricts(districtBytes ? JSON.parse(new TextDecoder().decode(districtBytes)) : null);
  const addressBytes = await asset('data/addresses.json');
  const addresses = addressBytes ? JSON.parse(new TextDecoder().decode(addressBytes)) : null;
  const gasBytes = await asset('data/gas-stations.json');
  const gasStations = gasBytes ? JSON.parse(new TextDecoder().decode(gasBytes)) : null;
  // the roof shapes OpenStreetMap's mappers tagged (build-roof-shapes.py), for the houses that have one
  const roofBytes = await asset('data/roof-shapes.json');
  setRoofShapes(roofBytes ? JSON.parse(new TextDecoder().decode(roofBytes)) : null);
  // how houses and shopfronts really look: the assessor's records and street photos (build-building-looks.py)
  const looksBytes = await asset('data/building-looks.json');
  setBuildingLooks(looksBytes ? JSON.parse(new TextDecoder().decode(looksBytes)) : null);
  const blocks = live.keep('blocks', () => cityPart((g) => buildCityBlocks(g, landmarkColliders, addresses, gasStations), { cull: setupSceneCulling, still: true }),
    { inputs: [heights, landmarks, parkingPart, bandShellPart, restroomsPart], from: [CITY_MAP, ...BUILDING_DATA, 'data/addresses.json', 'data/districts.json', 'data/gas-stations.json', 'data/roof-shapes.json', 'data/building-looks.json'] });
  const cityBlocks = blocks.made;
  markInit('blocks');
  const allColliders = [...landmarkColliders, ...cityBlocks.colliders, ...outskirts.colliders, ...(cityGrid.colliders || [])];

  await showLoadingStage('Placing trees, streetlights and street furniture...');
  // Lamp: trees, lamps and street furniture were placed on the ground as they were built; the street level under them
  // is set on it here
  // the city's hydrants and park benches, tables, shelters and courts (build-street-furniture.py)
  const furnitureBytes = await asset('data/street-furniture.json');
  const streetFurniture = furnitureBytes ? JSON.parse(new TextDecoder().decode(furnitureBytes)) : null;
  const details = await live.keep('streetDetails', () => cityPart(async (g) => {
    const made = buildStreetDetails(g, allColliders, streetFurniture, parkingPart.made.inside);
    await setOnTerrain(g.getObjectByName('StreetDetails'));
    return made;
  }, { cull: setupSceneCulling, still: true }), { inputs: [heights, grid, outskirtsPart, landmarks, blocks, parkingPart], from: [...TREE_DATA, 'data/street-furniture.json', 'js/street-details.js', 'js/tree-placements.js'] });
  const streetDetails = details.made;
  markInit('streetDetails');
  await showLoadingStage('Creating traffic and pedestrian routes...');
  const cityClosures = await loadCityClosures();
  // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
  // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them.
  // Elevated building sections that clear even a bus don't obstruct ground traffic (Lamp: measured from the ground
  // under them, as colliders' heights are the world's since the city stands on terrain.js's heights).
  const traffic = live.keep('traffic', () => cityPart((g) => createTrafficSystem(g, grid.made.sidewalks, [
    ...grid.made.footprints,
    ...details.made.footprints,
    CUBE_FOOTPRINT,
    ...parkingPart.made.footprints,
    bandShellPart.made.footprint,
    ...restroomsPart.made.footprints,
    ...allColliders.filter((c) => !c.obb
      && (c.minY ?? 0) - groundHeight((c.minX + c.maxX) * 0.5, (c.minZ + c.maxZ) * 0.5) < 3.5)
  ], details.made.signalIntersections, cityClosures)), { inputs: [heights, grid, outskirtsPart, landmarks, blocks, details], from: [CITY_MAP, 'data/city-closures.json', 'js/pedestrian-system.js'] });
  const trafficSystem = traffic.made;
  markInit('traffic');
  const highway = live.keep('highwayTraffic', () => cityPart((g) => createHighwayTraffic(g, grid.made.highwayLanes)), { inputs: [grid], from: [CITY_MAP] });
  const highwayTraffic = highway.made;
  await showLoadingStage('Adding road markings...');
  const roadPaint = await live.keep('roadPaint', () => cityPart(async (g) => {
    const made = buildRoadPaint(g, traffic.made.network);
    // (waited for: its strips are read for the cut, so they're handed to the GPU only once they're on the ground)
    await setOnTerrain(made, 0); // its strips come cut to length (road-paint.js)
    // in chunks, culled out of sight and far off (scene-culling.js); thin far strips are widened on screen
    made.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingSphere();
      o.geometry.boundingSphere.radius += 16;
    });
    return made;
  }, { cull: setupSceneCulling, still: true }), { inputs: [heights, traffic], from: [CITY_MAP, 'js/road-network.js'] });
  markInit('roadPaint');
  // Traffic lights and stop & yield signs where the road network put them (traffic-controls.js)
  const controlsPart = live.keep('trafficControls', () => cityPart((g) => buildTrafficControls(g, traffic.made.network), { cull: setupSceneCulling, still: true }), { inputs: [heights, traffic, details], from: ['js/traffic-controls.js'] });
  // Signs over the real shops, restaurants and cafes (shop-signs.js, from OpenStreetMap)
  const signsPart = live.keep('shopSigns', () => cityPart((g) => buildShopSigns(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/shop-signs.js'] });
  await showLoadingStage('Laying the railroads...');
  // The tracks and the trains on them, stood on the ground where they're built (railways.js)
  // where streets cross the tracks at grade, with gates (build-rail-crossings.py, OpenStreetMap)
  const crossingBytes = await asset('data/rail-crossings.json');
  const railCrossings = crossingBytes ? JSON.parse(new TextDecoder().decode(crossingBytes)) : [];
  // Amtrak's Wolverine stops at Ann Arbor on its timetable (build-wolverine.py, from Amtrak's GTFS feed)
  const wolverineBytes = await asset('data/wolverine.json');
  const wolverine = wolverineBytes ? JSON.parse(new TextDecoder().decode(wolverineBytes)) : null;
  const railPart = live.keep('railways', () => cityPart((g) => buildRailways(g, railCrossings, wolverine), { still: true }), { inputs: [heights], from: ['data/rail-crossings.json', 'data/wolverine.json'] });
  const railways = railPart.made;
  // Cars parked in the lots and along the main streets downtown, solid to the player (parked-cars.js)
  const parkedPart = live.keep('parkedCars', () => cityPart((g) => buildParkedCars(g, railways.nearTrack, parkingPart.made.stalls)), { inputs: [heights, parkingPart], from: ['js/parked-cars.js', 'js/railways.js', 'data/curb-cuts.bin.gz'] });
  const parkedCars = parkedPart.made;
  // Kayaks pulled up on the river's banks at the parks, to get into there (kayak-launches.js)
  const launchesPart = live.keep('kayakLaunches', () => cityPart((g) => buildKayakLaunches(g)), { inputs: [heights], from: ['js/kayak-launches.js'] });
  const kayakLaunches = launchesPart.made;
  log(`[kayaks] ${kayakLaunches.count} on the banks`);
  // The Gallup Park canoe livery: its docks, racks, rental kayaks and pedal boats, and people out on its pond (gallup-livery.js)
  const liveryPart = live.keep('gallupLivery', () => cityPart((g) => buildLivery(g)), { inputs: [heights], from: ['js/gallup-livery.js', 'js/river-people.js'] });
  for (const c of parkedCars.colliders) allColliders.push(c);
  // streamed, the parked cars near the camera come and go, and their boxes with them (parked-cars.js)
  parkedCars.onColliders = (added, removed) => {
    if (removed.size) {
      let n = 0;
      for (const c of allColliders) if (!removed.has(c)) allColliders[n++] = c;
      allColliders.length = n;
    }
    for (const c of added) allColliders.push(c);
    controllerManager._colliderCells = null; // (only from the frame step, once it's made)
  };
  // Road work: the blocks traffic.js closed, barricaded, coned and dug up (road-work.js); the machines are solid
  const roadWorkPart = live.keep('roadWork', () => cityPart((g) => buildRoadWork(g, traffic.made.closures)), { inputs: [heights, traffic], from: ['js/road-work.js'] });
  const roadWork = roadWorkPart.made;
  // Potholes from the City's 311 reports (potholes.js, build-potholes.py), felt as a jolt through the car
  const potholeBytes = await asset('data/potholes.json');
  const potholeData = potholeBytes ? JSON.parse(new TextDecoder().decode(potholeBytes)) : null;
  const potholesPart = live.keep('potholes', () => cityPart((g) => buildPotholes(g, potholeData)), { inputs: [heights, grid], from: ['js/potholes.js', 'data/potholes.json'] });
  const potholes = potholesPart.made;
  log(`[potholes] ${potholes.count} on the streets`);
  allColliders.push(...roadWork.colliders);
  allColliders.push(...airportPart.made.colliders);
  allColliders.push(...bleachersPart.made.colliders);
  // Tree trunks, lamp posts, signal poles and sign posts: thin and solid, so the car crashes into them and the bike
  // throws its rider (`thin`: the helicopter flies through them)
  // and each goes over when a car hits it hard enough (knockdowns.js)
  const obstacleBox = (o) => {
    const g = groundHeight(o.x, o.z);
    const knock = o.kind && (o.pose || o.parts?.length) ? { ...o, g, down: false } : null;
    return { minX: o.x - o.r, maxX: o.x + o.r, minZ: o.z - o.r, maxZ: o.z + o.r, minY: g - 1, maxY: g + 6, thin: true, knock };
  };
  const knockBoxOf = new Map();
  for (const o of [...(details.made.obstacles || []), ...(controlsPart.made.obstacles || []), ...(seatingPart.made.obstacles || [])]) {
    const b = obstacleBox(o);
    knockBoxOf.set(o, b);
    allColliders.push(b);
  }
  // where the player can sit (seats.js): the benches, cafe chairs, picnic benches and bleachers, each with what knocks it over
  const seatObstacles = seatingPart.made.obstacles || [];
  const seatSpots = createSeats({
    benches: (details.made.obstacles || []).filter((o) => o.kind === 'bench' && o.yaw != null),
    seats: seatingPart.made.seats || [],
    bleachers: bleachersPart.made.seats || [],
    boxOf: (s) => knockBoxOf.get(s.of != null ? seatObstacles[s.of] : s) || null
  });
  log(`[seats] ${seatSpots.count} places to sit`);
  // streamed, the trees near the camera come and go, and their trunks with them (trees.js)
  const treeField = details.made.treeField;
  if (TIER.stream && treeField?.obstacles) {
    const boxOf = new Map();
    const add = (list) => { for (const o of list) { const b = obstacleBox(o); boxOf.set(o, b); allColliders.push(b); } };
    add(treeField.obstacles());
    treeField.onObstacles = (added, removed) => {
      if (removed.length) {
        const gone = new Set();
        for (const o of removed) { gone.add(boxOf.get(o)); boxOf.delete(o); }
        let n = 0;
        for (const c of allColliders) if (!gone.has(c)) allColliders[n++] = c;
        allColliders.length = n;
      }
      add(added);
      controllerManager._colliderCells = null;
    };
  }
  // a hydrant knocked off its main gushes water (hydrant-spray.js)
  const hydrantSpray = createHydrantSpray(scene);
  const skidEffects = createSkidEffects(scene);
  // the car, sport bike or bicycle going into the river and out again (water-splash.js)
  const waterSplash = createWaterSplash(scene);
  const gushList = [];
  const knockdowns = createKnockdowns({
    onFall: (it, speed) => {
      log(`[knock] a ${it.kind} went over at ${Math.round(speed * 3.6)} km/h`);
      if (it.kind === 'hydrant') hydrantSpray.start(it.x, it.z);
    },
    onLand: (it, spin) => audioSystem?.cue(it.kind === 'tree' ? 'thud' : 'crash',
      { x: it.x + it.dx * it.height * 0.6, y: it.g, z: it.z + it.dz * it.height * 0.6 }, Math.min(1, 0.4 + spin * 0.2))
  });
  // Lamp: Ann Arbor's animals, near the player only; never anyone's obstacle (animals.js)
  const animalsPart = live.keep('animals', () => cityPart((g) => buildAnimals(g)), { inputs: [heights, details], from: ['js/animals.js', 'js/animal-models.js', 'js/animal-birds.js', 'js/river-birds.js', 'js/deer.js'] });
  // Lamp: the Cube on Regents Plaza, which turns when it's pushed or hit (the-cube.js)
  const cubePart = live.keep('cube', () => cityPart((g) => buildCube(g)), { inputs: [heights], from: ['js/the-cube.js'] });
  allColliders.push(cubePart.made.collider);
  const parts = [grid, bandShellPart, restroomsPart, cascadesPart, riverPeoplePart, animalsPart, cubePart, outskirtsPart, landmarks, blocks, details, traffic, highway, roadPaint, controlsPart, signsPart, railPart, parkedPart, launchesPart, liveryPart, roadWorkPart, potholesPart, planesPart, scootersPart, racksPart, poolsPart, seatingPart, diamondsPart, bleachersPart, docksPart, skatePart, mtbPart, parkingPart, airportPart, moonPart];
  for (const part of parts) {
    scene.add(part.group);
    cullAlso(part.culled);
  }
  // What a part hooks on its scene's renders is on its group, which three.js never calls (the trees follow the view
  // camera for their level of detail, trees.js): the scene calls it for each part.
  // the houses near the player, on a phone (houses.js streamHouses)
  const houseStream = blocks.group.getObjectByName('AnnArborHouses')?.userData.stream;
  // Lamp: snow lies where it really lies today (snow-cover.js), on what stands still: moving traffic, people, the
  // river and the sky stay as they are
  // (only once there is snow: on a bare day the materials keep their shaders as they are)
  loadSnowCover().then((cover) => {
    if (cover > 0) for (const part of [grid, bandShellPart, restroomsPart, outskirtsPart, landmarks, blocks, details, controlsPart, signsPart, railPart, parkedPart, roadWorkPart, scootersPart, racksPart, seatingPart, diamondsPart, bleachersPart, docksPart, skatePart, mtbPart, parkingPart, airportPart]) dressForSnow(part.group);
  });
  const partHooks = parts.map((part) => part.group).filter((g) => g.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender);
  scene.onBeforeRender = (...args) => { for (const g of partHooks) g.onBeforeRender(...args); };
  markInit('ground');

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter) & Multi-Camera System
  await showLoadingStage('Preparing player, vehicles and controls...');
  const controllerManager = new ThirdPersonControllerManager(scene, allColliders);
  controllerManager.knockdowns = knockdowns;
  controllerManager.parkedCars = parkedCars;
  controllerManager.kayakLaunches = kayakLaunches;
  controllerManager.livery = liveryPart.made;
  controllerManager.docks = docksPart.made;
  controllerManager.seats = seatSpots;
  controllerManager.skatePark = skatePart.made;
  controllerManager.mtbTrails = mtbPart.made;
  controllerManager.parking = parkingPart.made;
  controllerManager.bikeRacks = racksPart.made;
  controllerManager.pools = poolsPart.made;
  controllerManager.scooters = scootersPart.made;
  controllerManager.airport = airportPart.made;
  // the player's flying machine is a helicopter or the plane they took last (airport.js dress)
  airportPart.made.dress(controllerManager.entities.helicopter);
  controllerManager.roadWork = roadWork;
  // the playgrounds' wave slides and decks, driven up like ramps (playgrounds.js)
  controllerManager.playTop = cityGrid.playTop || null;
  controllerManager.potholes = potholes;
  controllerManager.railways = railways;
  // the maize sports car, or the black Forester it was before (an older save's own car)
  const isOwnLook = (look) => (look.kind === 'sports' && look.hex === 0xffcb05) || (look.kind === 'forester' && look.hex === 0x16181b);
  // The cars taken from parking spots and left in them in earlier plays (a part kept over a change has them still)
  if (!parkedCars.history.length) {
    const added = parkedCars.replay(load('parkedSwaps'));
    if (added.length) { allColliders.push(...added); controllerManager._colliderCells = null; }
  }
  // Where each way of getting around starts, a view of the city at each (heading 0 faces south, PI north)
  const SCENIC_STARTS = {
    // on the Diag, looking up Ingalls Mall to Burton Tower and Hill Auditorium
    person: { x: 845, z: 242, heading: Math.atan2(797 - 845, 23 - 242) },
    // Main St at William, in the northbound lane, looking up downtown's shopfronts
    car: { x: -23, z: 228, heading: Math.atan2(14.8, -378) },
    // South University's eastbound bike lane, campus on the left
    cyclist: { x: 660, z: 529, heading: Math.PI / 2 },
    // high over Stadium Blvd south of the Big House, the stadium below and downtown beyond it
    helicopter: { x: -30, z: 1950, heading: Math.PI, above: 130 },
    // in the Argo Cascades' channel just above its first drop, facing down it (cascades.js)
    kayak: { ...CASCADE_START }
  };

  // Reuse teleport placement so saved players return at rest, close to their last positions.
  try {
    // Kept with Lamp's save(), which the preview keeps to one play, so every preview starts in the same place.
    const saved = load('player');
    if (saved?.version !== 2) {
      // a first play: each of them waiting at its own start, the player in the car on Main St
      for (const [mode, s] of Object.entries(SCENIC_STARTS)) {
        if (!controllerManager.entities[mode]) continue;
        controllerManager.setMode(mode);
        controllerManager.teleportActiveTo(s.x, s.z, s.heading, s.above ? groundHeight(s.x, s.z) + s.above : null);
        // the kayak faces the cascades' channel, not the way the pond's water would turn it
        if (mode === 'kayak') { const k = controllerManager.entities.kayak; k.heading = s.heading; k.mesh.rotation.y = s.heading; }
      }
      controllerManager.setMode('car');
    }
    if (saved?.version === 2) {
      for (const mode of Object.keys(controllerManager.entities)) {
        const p = saved.entities?.[mode];
        if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
        controllerManager.setMode(mode);
        controllerManager.teleportActiveTo(p.x, p.z, p.heading, p.y);
      }
      controllerManager.setMode(Object.hasOwn(controllerManager.entities, saved.activeMode) ? saved.activeMode : 'car');
      // the car the player drives (one taken from a parking spot or traffic), and whether they're in something
      if (saved.carLook && !isOwnLook(saved.carLook)) controllerManager.restyleCar(saved.carLook);
      // the machine they drove off in is no longer at its dig
      const sc = saved.entities?.car;
      // airstairs driven and left standing are the airport's, the player's car hidden; while driven, the player's
      if (controllerManager.entities.car.machine === 'stairtruck') {
        if (saved.activeMode === 'car') { if (!airportPart.made.stairsHeld) retakeStairs(); }
        else if (airportPart.made.stairsHeld) airportPart.made.claimStairs?.();
      }
      else if (controllerManager.entities.car.machine && sc && !roadWork.held) roadWork.claim(saved.carLook.kind, sc.x, sc.z);
      if (saved.activeMode !== 'person' && Object.hasOwn(controllerManager.entities, saved.activeMode)) {
        controllerManager.entities.person.riding = saved.activeMode;
        controllerManager.entities[saved.activeMode].leftEmpty = false;
      }
      for (const mode of saved.leftEmpty || []) if (controllerManager.entities[mode]) controllerManager.entities[mode].leftEmpty = true;
      // a boat taken from the Gallup Park livery is still the player's, and its spot there still empty
      controllerManager.dressBoat(saved.boat);
      if (saved.liveryTaken >= 0) liveryPart.made.take(saved.liveryTaken, true);
      if (saved.docksTaken >= 0) docksPart.made.take(saved.docksTaken);
    }
  } catch { /* Missing or unavailable storage does not prevent playing. */ }

  function savePlayerState() {
    try {
      // one sitting down is kept where they stood to sit
      const entities = Object.fromEntries(Object.entries(controllerManager.entities).map(([mode, entity]) => [mode, entity.sitting ? {
        ...entity.sitting.from, heading: entity.heading
      } : {
        x: entity.position.x, y: entity.position.y, z: entity.position.z, heading: entity.heading
      }]));
      const leftEmpty = Object.keys(controllerManager.entities).filter((mode) => controllerManager.entities[mode].leftEmpty);
      save('player', { version: 2, activeMode: controllerManager.activeMode, entities, carLook: controllerManager.carLook, leftEmpty,
        boat: controllerManager.entities.kayak.boat, liveryTaken: liveryPart.made.taken, docksTaken: docksPart.made.taken });
      save('parkedSwaps', parkedCars.history);
    } catch { /* Storage may be disabled or full. */ }
  }

  const keptCamera = live.keep('camera', () => CameraSystem.makeCamera());
  // a camera that once followed a broken position keeps it: start it again rather than draw nothing
  if (![keptCamera.position.x, keptCamera.position.y, keptCamera.position.z, keptCamera.quaternion.w].every(Number.isFinite)) {
    keptCamera.position.set(0, 50, 100); keptCamera.quaternion.identity(); keptCamera.updateMatrixWorld(true);
  }
  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager, keptCamera);
  cameraSystem.onResize(1920, 1080);
  const touchControls = new TouchControls(controllerManager);
  const soundButton = document.getElementById('btn-sound');
  const audioSystem = new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails }, {
    onStateChange: updateSoundButton
  });
  // a cone, drum or barricade the player runs into: a knock, a bang (road-work.js)
  roadWork.onHit = (it, speed, who) => {
    audioSystem.cue(it.kind === 'cone' ? 'thud' : 'crash', { x: it.x, y: it.g, z: it.z }, Math.min(1, (it.kind === 'cone' ? 0.25 : 0.4) + speed * 0.02));
    if (who === 'player' && speed > 8 && it.kind !== 'cone') log(`[road work] hit a ${it.kind} at ${Math.round(speed * 2.237)} mph`);
  };
  function updateSoundButton() {
    if (!soundButton) return;
    soundButton.disabled = !audioSystem.supported;
    soundButton.setAttribute('aria-pressed', String(audioSystem.enabled));
    soundButton.setAttribute('aria-label', audioSystem.enabled ? 'Mute sound' : 'Enable sound');
    soundButton.title = audioSystem.supported ? `${audioSystem.enabled ? 'Mute' : 'Enable'} sound [N]` : 'Web Audio is unavailable';
    soundButton.querySelector('use').setAttribute('href', audioSystem.enabled ? '#i-sound' : '#i-sound-off');
  }
  soundButton?.addEventListener('click', () => audioSystem.setEnabled(!audioSystem.enabled));
  updateSoundButton();

  // recording mode: the top bar's record button saves a video of the drive into Movies
  // (made here when the page was opened before the button was in it, so it shows without a reload)
  let recordButton = document.getElementById('btn-record');
  if (!recordButton && soundButton) {
    recordButton = document.createElement('button');
    recordButton.id = 'btn-record';
    recordButton.className = 'tool-btn icon-only';
    recordButton.type = 'button';
    recordButton.setAttribute('aria-pressed', 'false');
    recordButton.innerHTML = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2"/>'
      + '<circle cx="12" cy="12" r="4.4" fill="currentColor" stroke="none"/></svg><span class="rec-time" hidden></span>';
    soundButton.before(recordButton);
  }
  if (recordButton) { recordButton.title = 'Record a video'; recordButton.setAttribute('aria-label', 'Record a video'); }
  const recordLabel = recordButton?.querySelector('.rec-time');
  if (recordLabel) { recordLabel.classList.remove('tool-label'); recordLabel.textContent = ''; recordLabel.hidden = true; }
  recordButton?.classList.add('icon-only');
  let recordShown = -1;
  const videoRecorder = new VideoRecorder(renderer.domElement, audioSystem, (on, saved, secs) => {
    recordButton?.setAttribute('aria-pressed', String(on));
    recordButton?.setAttribute('aria-label', on ? 'Stop recording' : 'Record a video');
    if (recordButton) recordButton.title = on ? 'Stop recording' : 'Record a video';
    // just the icon; while it records, the time beside it
    if (recordLabel) { recordLabel.textContent = on ? '0:00' : ''; recordLabel.hidden = !on; }
    recordButton?.classList.toggle('icon-only', !on);
    recordShown = -1;
    if (on) showNotice('Recording');
    else if (saved) showNotice(window.LampNative?.available ? `Saved a ${secs} s video to Movies` : 'Video saved');
    else if (saved === null) showNotice('The video could not be saved');
  });
  if (recordButton && !videoRecorder.supported) { recordButton.hidden = true; log('[recording] this browser can not record video'); }
  recordButton?.addEventListener('click', () => videoRecorder.toggle());
  function tickRecording(dt) {
    videoRecorder.update(dt);
    const s = Math.floor(videoRecorder.seconds);
    if (videoRecorder.recording && s !== recordShown && recordLabel) {
      recordShown = s;
      recordLabel.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
  }
  // a wheel through a pothole: a thump under the car
  const _holeAt = { x: 0, y: 0, z: 0 };
  controllerManager.onPothole = (x, z, strength) => {
    _holeAt.x = x; _holeAt.z = z; _holeAt.y = groundHeight(x, z) + 0.3;
    audioSystem.cue('thud', _holeAt, Math.min(1, 0.25 + strength * 0.6));
    log(`[pothole] a wheel through one, ${strength.toFixed(2)} hard`);
  };
  // someone knocked down by the player's car or bike: a thump there and a jolt in the hands
  const _thudAt = { x: 0, y: 0, z: 0 };
  trafficSystem.setPedestrianHitListener?.((x, z, speed) => {
    _thudAt.x = x; _thudAt.z = z; _thudAt.y = groundHeight(x, z) + 0.6;
    audioSystem.cue('thud', _thudAt, Math.min(1, 0.4 + speed / 20));
    rumble(0, Math.min(1, 0.3 + speed / 25), Math.min(1, 0.2 + speed / 30), 0.25);
    log(`Knocked someone down at ${speed.toFixed(1)} m/s`);
  });
  // the player hit by a car, on foot or on the bike
  trafficSystem.setPlayerStruckListener?.((vx, vz, speed, type) => {
    const at = controllerManager.getActiveEntity().position;
    audioSystem.cue('thud', at, Math.min(1, 0.5 + speed / 20));
    rumble(0, Math.min(1, 0.5 + speed / 20), Math.min(1, 0.4 + speed / 25), 0.35);
    if (type === 'cyclist') controllerManager.throwRider(speed, vx, vz);
    else if (type === 'motorbike') controllerManager.throwMotoRider(speed, vx * 0.6, vz * 0.6);
    else controllerManager.knockDown(vx * 1.1, 1.5 + speed * 0.2, vz * 1.1, 0, 0.6);
    log(`Hit by a car at ${speed.toFixed(1)} m/s`);
  });
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    savePlayerState();
    if (!event.persisted) audioSystem.dispose();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
  markInit('controllers');

  // The shadow stand-ins each part made (cityPart) draw in this run's sun shadow
  showShadowStandIns(lightingSystem.sunLight.shadow);

  // Initialize static world matrices once, including the chunks and shadow proxies created above.
  // Crowd, tree and building-detail animation changes instance/pose buffers, not Object3D transforms.
  const dynamicRoots = [
    trafficSystem.group,
    highwayTraffic.group,
    railways.group.getObjectByName('Trains'),
    scene.getObjectByName('StoreClusteredLights'),
    scene.getObjectByName('StreetClusteredLights'),
    ...Object.values(controllerManager.entities).map((entity) => entity.mesh),
    controllerManager.entities.cyclist.helmet
  ];
  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;
  markInit('culling');

  // Lamp: without the clustered lighting the many little street, shop and car lights go (the sun and sky stay)
  if (!QUALITY.streetLights) {
    const smallLights = [];
    scene.traverse((object) => { if (object.isPointLight || object.isSpotLight) smallLights.push(object); });
    for (const light of smallLights) light.removeFromParent();
    console.log(`[quality] removed ${smallLights.length} small lights`);
  }
  if (!QUALITY.outskirts) {
    const group = scene.getObjectByName('Outskirts');
    if (group) group.visible = false;
  }
  console.log(`[quality] ${JSON.stringify(QUALITY)}`);
  if (MEASURE_MEMORY) reportMemory(scene, renderer, log, TIER.name !== 'full');

  // On WebGPU, small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes only upload when needed; WebGL2 needs ordinary instanced attributes for correct transforms.
  if (renderer.backend.isWebGPUBackend) {
    scene.traverse((object) => {
      if (object.isInstancedMesh) {
        object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
      }
    });
  }

  // 5. TSL RenderPipeline with Half-Res Screen Space Reflections (SSRNode), Bloom & Filmic Toning
  //    Fade out distant and matte surfaces so SSR spends its rays on visible glossy reflections.
  await showLoadingStage('Setting up visual effects, map and interface...');
  let renderPipeline, scenePass, colorGrade, ssrPass = null, sceneMRT = null;
  if (!QUALITY.reflections) {
    scenePass = pass(scene, cameraSystem.camera);
    scenePass.renderTarget.storeMultisampledColorBuffer = false;
    scenePass.renderTarget.storeMultisampledDepthBuffer = false;
    scenePass.renderTarget.resolveDepthBuffer = false;
    colorGrade = createPostProcessing(renderer, scenePass.getTextureNode('output'), vec3(0), { bloom: QUALITY.bloom });
    renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);
  } else {
  scenePass = pass(scene, cameraSystem.camera);
  // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
  // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
  // the browser supports them). The multisampled depth stays stored: SSR reads it.
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
  const maxSSRRoughness = 0.75;
  sceneMRT = mrt({
    output: output,
    normal: normalView,
    metalRough: vec2(roughness.lessThan(maxSSRRoughness).select(metalness.mul(ssrFade), 0), roughness)
  });
  sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
  sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(sceneMRT);

  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassDepth = scenePass.getTextureNode('depth');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassMetalRough = scenePass.getTextureNode('metalRough');

  ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, {
    metalnessNode: scenePassMetalRough.r,
    roughnessNode: scenePassMetalRough.g,
    camera: cameraSystem.camera
  });
  ssrPass.resolutionScale = 0.5;
  ssrPass.blurQuality = 1;
  ssrPass.maxDistance.value = 42;
  ssrPass.thickness.value = 0.85;
  // Fewer coarse steps, then refine detected hits to keep reflection edges precise.
  ssrPass.quality.value = 0.25;
  ssrPass.binaryRefine = true;
  ssrPass.intensity.value = 0.50;
  ssrPass.screenEdgeFadeBlack = true;

  // Roughness mip blur must not spread reflections back onto matte or nonreflective surfaces.
  const reflectionMask = scenePassMetalRough.r.greaterThan(0).select(smoothstep(maxSSRRoughness, 0.55, scenePassMetalRough.g), 0);
  const reflections = ssrPass.mul(reflectionMask);
  colorGrade = createPostProcessing(renderer, scenePassColor, reflections);
  renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);
  }

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  const modeButtons = document.querySelectorAll('[data-mode]');
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  // On a touch screen the game opens in clean view (the eye closed); the player's own choice, or a kept one, stands.
  let hudChosen = false;
  touchControls.onAvailabilityChange = () => {
    placeModeIndicator();
    if (touchControls.available && !hudChosen && hudToggleBtn && !document.body.classList.contains('hud-minimized')) hudToggleBtn.click();
    hudChosen = true;
  };
  touchControls.onGetInOut = () => getInOrOut();

  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elAltitude = document.getElementById('hud-altitude');
  const elGear = document.getElementById('hud-gear');
  const elRpm = document.getElementById('hud-rpm');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onCycleMode: (step) => {
      const modes = ['person', 'car', 'cyclist', 'helicopter', 'kayak'];
      travelBy(modes[(modes.indexOf(controllerManager.activeMode) + step + modes.length) % modes.length]);
    },
    onCycleCamera: cycleCamera,
    onGetInOut: getInOrOut,
    onToggleMap: () => mapSystem.toggleFullMap(!mapSystem.isFullMapOpen),
    onCloseMap: () => mapSystem.toggleFullMap(false),
    onRadio: (dir) => carRadio.tune(dir)
  });
  const carRadio = new CarRadio();

  // The guide to each mode's controls, written once: the keys the city reads (by their codes, as controllers.js and the
  // keydown handler below have them) and the controller's buttons, sticks and triggers (as gamepad-controls.js reads
  // Lamp's pad). It shows the half for what the player is holding, named and drawn by Lamp's runtime.
  const orbit = { keys: ['Drag'], pad: [STICK.RIGHT], does: 'Orbit' };
  const controlHints = {
    person: [{ keys: ['KeyW', 'KeyS'], does: 'Walk / Run' }, { keys: ['KeyA', 'KeyD'], does: 'Turn' },
      { pad: [STICK.LEFT], does: 'Walk / Run & turn' }, { keys: ['Space'], pad: [BUTTON.A], does: 'Jump' }, orbit, { keys: ['KeyR'], pad: [BUTTON.RIGHT], does: 'Music' }],
    car: [{ keys: ['KeyW', 'KeyS'], pad: [TRIGGER.RT, TRIGGER.LT], does: 'Drive / Reverse' },
      { keys: ['KeyA', 'KeyD'], pad: [STICK.LEFT], does: 'Steer' }, { keys: ['Space'], pad: [BUTTON.A], does: 'Handbrake' },
      { keys: ['KeyB'], does: 'Horn' }, { keys: ['KeyR'], pad: [BUTTON.RIGHT], does: 'Radio' }, { pad: [STICK.RIGHT], does: 'Orbit' }],
    cyclist: [{ keys: ['KeyW', 'KeyS'], pad: [TRIGGER.RT, TRIGGER.LT], does: 'Pedal / Brake' },
      { keys: ['KeyA', 'KeyD'], pad: [STICK.LEFT], does: 'Lean & Turn' }, orbit, { keys: ['KeyR'], pad: [BUTTON.RIGHT], does: 'Music' }],
    helicopter: [{ keys: ['KeyW', 'KeyS'], does: 'Pitch' }, { keys: ['KeyA', 'KeyD'], does: 'Yaw' },
      { pad: [STICK.LEFT], does: 'Pitch & Yaw' }, { keys: ['Space', 'KeyE'], pad: [TRIGGER.RT], does: 'Ascend' },
      { keys: ['KeyQ', 'KeyC'], pad: [TRIGGER.LT], does: 'Descend' }],
    plane: [{ keys: ['KeyW', 'KeyS'], does: 'Throttle / Brake' }, { keys: ['KeyA', 'KeyD'], does: 'Turn' },
      { pad: [STICK.LEFT], does: 'Throttle & turn' }, { keys: ['Space', 'KeyE'], pad: [TRIGGER.RT], does: 'Pull up' },
      { keys: ['KeyQ', 'KeyC'], pad: [TRIGGER.LT], does: 'Nose down' }],
    kayak: [{ keys: ['KeyW', 'KeyS'], does: 'Paddle / Back' }, { keys: ['KeyA', 'KeyD'], does: 'Turn' },
      { pad: [STICK.LEFT], does: 'Paddle & turn' }, orbit, { keys: ['KeyR'], pad: [BUTTON.RIGHT], does: 'Music' }]
  };
  // Getting in and out, in every mode
  for (const [mode, hints] of Object.entries(controlHints)) {
    hints.push({ keys: ['KeyF'], pad: [BUTTON.X], does: mode === 'person' ? 'Get in / Sit' : 'Get out', getOut: mode !== 'person' });
  }
  // Getting out of a car on the move or the helicopter in the air is a jump, and its hint says so
  let jumpOut = false;
  // Top speeds in mph (controllers.js caps them at 8.2, 36, 19 & 52 m/s): full scale of the speed meter
  const topSpeedMph = { person: 18, car: 160, cyclist: 28, helicopter: 167, kayak: 12 };

  // The gear and revs on the dial in a car come from the same gearbox as the engine sound (gearbox.js), fed the
  // road speed and a throttle worked out from how fast the speed is changing: R in reverse, N at rest
  const hudBox = newGearState();
  const hud = { shownMph: -1, shownGear: '', shownRpm: -1, clock: 0, lastClock: 0, lastSpeed: 0, load: 0, first: true };
  function gearReadout(speedMps, forward) {
    const dt = Math.max(0.05, hud.clock - hud.lastClock);
    const accel = (speedMps - hud.lastSpeed) / dt;
    hud.lastClock = hud.clock;
    hud.lastSpeed = speedMps;
    // as audio-sources.js roadLoad: acceleration over a car's best (about 5 m/s²) plus what holding speed takes
    const want = Math.min(1, Math.max(0, accel / 5 + Math.min(1, speedMps / 2) * (0.12 + 0.28 * Math.min(1, speedMps / 30) ** 2)));
    hud.load += (want - hud.load) * 0.6;
    shiftGear(hudBox, speedMps, hud.load, hud.clock, hud.first, CAR_RATIOS);
    hud.first = false;
    const rpm = engineRPM(hudBox, speedMps, hud.load, CAR_RATIOS, 780);
    const gear = speedMps < 0.5 ? 'N' : !forward ? 'R' : 'D' + (hudBox.gear + 1);
    return { gear, rpm: Math.round(rpm / 50) * 50 };
  }

  // The speedometer: the speed in large digits over a bar filled to its share of the mode's top speed
  const dialScale = { max: 0 };
  function buildDial(mode, drive = null) {
    // a car whose top speed is past the usual scale (the sports car, the performance EV) gets a bar that reaches it
    dialScale.max = Math.max(topSpeedMph[mode] || 80, mode === 'car' && drive?.speed ? drive.speed * 2.237 : 0);
  }

  // Keys in the city's own keycaps; a controller's buttons as the runtime draws them for that controller.
  function renderControlHints(mode, on = input()) {
    if (!elControlsHint) return;
    if (mode === 'helicopter' && controllerManager.entities.helicopter.craft === 'plane') mode = 'plane';
    const pad = on.kind === 'controller';
    const items = (controlHints[mode] || []).filter((hint) => pad ? hint.pad : hint.keys).map((hint) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const what of pad ? hint.pad : hint.keys) {
        if (pad) {
          const badge = glyph(what, on);
          if (badge) item.appendChild(badge);
          continue;
        }
        const kbd = document.createElement('kbd');
        kbd.textContent = label(what, on);
        item.appendChild(kbd);
      }
      const words = document.createElement('span');
      words.className = 'hint-label';
      words.textContent = hint.getOut && jumpOut ? 'Jump out' : hint.does;
      item.appendChild(words);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The keys named on the HUD's buttons (data-key, a key's code) and, with a controller, the button that does the same
  // (data-pad); a key with no button on the controller is hidden then (style.css, by body[data-input]).
  function relabelKeys(on) {
    document.body.dataset.input = on.kind;
    for (const kbd of document.querySelectorAll('kbd[data-key], kbd[data-pad]')) {
      const badge = on.kind === 'controller' && kbd.dataset.pad ? glyph(BUTTON[kbd.dataset.pad], on) : null;
      if (badge) kbd.replaceChildren(badge);
      else if (kbd.dataset.key) kbd.textContent = label(kbd.dataset.key, on);
    }
  }

  // The taxi-yellow pill under the selected mode glides from button to button
  function placeModeIndicator() {
    const active = modeSwitch ? modeSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    modeSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    modeSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  function selectMode(mode) {
    controllerManager.setMode(mode);
    touchControls.setMode(controllerManager.activeMode);
    gamepadControls.reset();
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    document.body.dataset.mode = mode;
    placeModeIndicator();
    // the touch bar's first button shows how the player travels now, its list which one
    const modeIcon = document.querySelector(`#mode-switch [data-mode="${mode}"] use`)?.getAttribute('href');
    if (modeIcon) document.querySelector('#cb-mode use')?.setAttribute('href', modeIcon);
    document.querySelectorAll('.pop-mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const ent = controllerManager.getActiveEntity();
    if (elMode) setDialName(ent.label);
    jumpOut = false;
    renderControlHints(mode);

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }

  // 1 to 5 (the mode buttons, the bumpers): another way of getting around starts at its own view of the city, unless
  // it's already close by (the car the player just stepped out of), when the player simply takes it
  function travelBy(mode) {
    const cm = controllerManager;
    if (mode === 'car' && cm.entities.car.machine === 'stairtruck' && !airportPart.made.stairsHeld) retakeStairs();
    if (mode === cm.activeMode || !cm.entities[mode]) { selectMode(mode); return; }
    const here = cm.getActiveEntity().position, there = cm.entities[mode].position;
    const close = Math.hypot(there.x - here.x, there.z - here.z) < 40;
    selectMode(mode);
    if (!close) goToStart(mode);
  }
  // Reset game: every way of getting around back at its own start, the player in their own car on Main St, the time
  // back to now and what earlier plays left behind (parked cars swapped) forgotten
  function resetGame() {
    const cm = controllerManager;
    const p = cm.entities.person;
    p.fallen = null;
    cm.dropChute();
    if (p.rig) p.rig.ragdolling = false;
    p.riding = null;
    cm.setMode('person');
    if (cm.entities.car.machine === 'stairtruck') { const c = cm.entities.car; airportPart.made.leaveStairs(c.position.x, c.position.z, c.heading); }
    if (!isOwnLook(cm.carLook)) cm.restyleCar({ kind: 'sports', hex: 0xffcb05, style: 0 });
    roadWork.home();
    cm.dressBoat('kayak');
    liveryPart.made.release();
    docksPart.made.release();
    cm._colliderCells = null;
    for (const [mode, s] of Object.entries(SCENIC_STARTS)) {
      const e = cm.entities[mode];
      if (!e) continue;
      cm.setMode(mode);
      e.leftEmpty = false;
      cm.teleportActiveTo(s.x, s.z, s.heading, s.above ? groundHeight(s.x, s.z) + s.above : null);
      if (mode === 'kayak') { e.heading = s.heading; e.mesh.rotation.y = s.heading; }
      if (mode === 'car') cm.stopCar(e);
    }
    p.riding = 'car';
    selectMode('car');
    parkedCars.history.length = 0;
    selectTime('now');
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    savePlayerState();
    log('[reset] game reset to its start');
    showNotice('Back to the start');
  }
  document.getElementById('reset-confirm')?.addEventListener('click', () => {
    closePopovers();
    resetGame();
  });

  function goToStart(mode) {
    const s = SCENIC_STARTS[mode];
    if (!s) return;
    controllerManager.teleportActiveTo(s.x, s.z, s.heading, s.above ? groundHeight(s.x, s.z) + s.above : null);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    savePlayerState();
  }

  // F (or the controller's X, or the touch button): out of what the player is in, or into the nearest thing: their car,
  // the bike, the kayak, the helicopter on the ground, a parked car or one going by (which the player's car becomes)
  // A short line in the middle of the screen that fades by itself (CSS .notice)
  let noticeEl = null, noticeTimer = 0;
  // a green-brown wash over the view while the camera is under the river, darker toward the edges
  let lastUnder = 0;
  const underwaterEl = document.createElement('div');
  underwaterEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;opacity:0;transition:opacity .25s;' +
    'background:radial-gradient(ellipse at 50% 35%, rgba(40,90,70,0), rgba(8,28,22,.18) 95%)';
  document.body.appendChild(underwaterEl);
  function showNotice(text, secs = 1.6) {
    if (!noticeEl) { noticeEl = document.createElement('div'); noticeEl.className = 'notice'; document.body.appendChild(noticeEl); }
    noticeEl.textContent = text;
    noticeEl.classList.add('show');
    noticeTimer = secs;
  }
  function tickNotice(dt) {
    if (noticeTimer > 0 && (noticeTimer -= dt) <= 0) noticeEl?.classList.remove('show');
  }

  // Airstairs the player got out of stand where they left them (airport.js leaveStairs), to climb and jump off; the
  // car they drove them as is hidden until they drive them again (retakeStairs, from the airstairs nearest it)
  function parkStairs() {
    const c = controllerManager.entities.car;
    airportPart.made.leaveStairs(c.position.x, c.position.z, c.heading);
    c.mesh.visible = false;
    log('[airport] left the airstairs');
  }
  function retakeStairs() {
    const c = controllerManager.entities.car, st = airportPart.made.nearestStairs?.(c.position.x, c.position.z, 3);
    if (!st) return;
    airportPart.made.takeStairs(st.i);
    c.position.set(st.x, controllerManager.getGroundHeight(st.x, st.z, 'car'), st.z);
    c.heading = st.yaw;
    c.prevX = c.position.x;
    c.prevZ = c.position.z;
    c.mesh.position.copy(c.position);
    c.mesh.rotation.y = c.heading;
  }

  function getInOrOut() {
    if (mapSystem.isFullMapOpen) return;
    const cm = controllerManager;
    const was = cm.activeMode;
    cm.traffic = trafficSystem;
    // a bus: on at a stop, where its driver waits for the player, and off at the next one
    const p = cm.entities.person;
    // on a bench, a chair or the bleachers: up again
    if (was === 'person' && p.sitting) { cm.standUp(); return; }
    if (was === 'person' && p.onBus) {
      const ride = trafficSystem.busRide();
      if (ride && !ride.stopped && !ride.gone) { showNotice('The bus will stop at the next stop'); return; }
      cm.getOffBus(trafficSystem.leaveBus());
      audioSystem.cue('door', p.position, 0.7);
      log('[bus] got off');
      savePlayerState();
      return;
    }
    if (was === 'person' && !p.fallen) {
      const ride = trafficSystem.boardBus(p.position.x, p.position.z, 5);
      if (ride) {
        cm.getOnBus(ride);
        audioSystem.cue('door', p.position, 0.7);
        showNotice(ride.route ? `Route ${ride.route} to ${ride.headsign}` : 'On the bus');
        log(`[bus] got on${ride.route ? ` route ${ride.route}` : ''}`);
        return;
      }
    }
    const choice = cm.enterOrExit(parkedCars, trafficSystem);
    if (!choice) return;
    if (choice.sit) { cm.sitDown(choice.sit); return; }
    const car = cm.entities.car;
    let drop = null;
    if (choice.parked || choice.moving || choice.machine || choice.rack || choice.stairs) {
      // the car the player had is left parked where it is (a machine from the road work, back on the ground there)
      drop = { ...cm.carLook, x: car.position.x, z: car.position.z, yaw: car.heading,
        y: Math.max(0, car.position.y - cm.getGroundHeight(car.position.x, car.position.z, 'car', -Infinity)) };
      if (car.machine === 'stairtruck') { airportPart.made.leaveStairs(drop.x, drop.z, drop.yaw); drop = null; }
      else if (car.machine) { roadWork.leave(drop.x, drop.z, drop.yaw); cm._colliderCells = null; drop = null; }
      if (choice.stairs) {
        // the airport's airstairs, driven off their spot; the car the player had is left parked
        if (drop) { const done = parkedCars.take(null, drop); if (done?.collider) { allColliders.push(done.collider); cm._colliderCells = null; } }
        const st = choice.stairs;
        cm.restyleCar(airportPart.made.takeStairs(st.i));
        cm.stopCar(car);
        car.position.set(st.x, cm.getGroundHeight(st.x, st.z, 'car'), st.z);
        car.heading = st.yaw;
        car.prevX = car.position.x;
        car.prevZ = car.position.z;
        car.mesh.position.copy(car.position);
        car.mesh.rotation.y = car.heading;
        log('[airport] drove off in the airstairs');
      }
      if (choice.machine) {
        if (drop) { const done = parkedCars.take(null, drop); if (done?.collider) allColliders.push(done.collider); }
        const m = choice.machine;
        const look = roadWork.take(m.machine);
        cm._colliderCells = null;
        cm.restyleCar(look);
        cm.stopCar(car);
        car.position.set(m.x, cm.getGroundHeight(m.x, m.z, 'car'), m.z);
        car.heading = m.yaw;
        car.prevX = car.position.x;
        car.prevZ = car.position.z;
        car.mesh.position.copy(car.position);
        car.mesh.rotation.y = car.heading;
        log(`[car] climbed into ${look.kind === 'dumptruck' ? 'a dump truck' : 'an excavator'} at the road work`);
      }
    }
    if (choice.rack) {
      // a bike borrowed off a rack or an e-bike dock (bike-racks.js); the car the player had is left parked
      if (drop) { const done = parkedCars.take(null, drop); if (done?.collider) { allColliders.push(done.collider); cm._colliderCells = null; } }
      const look = (choice.rack.from || racksPart.made).take(choice.rack.slot);
      cm.restyleCar(look);
      cm.stopCar(car);
      car.position.set(choice.rack.x, cm.getGroundHeight(choice.rack.x, choice.rack.z, 'car'), choice.rack.z);
      car.heading = choice.rack.yaw;
      car.prevX = car.position.x;
      car.prevZ = car.position.z;
      car.mesh.position.copy(car.position);
      car.mesh.rotation.y = car.heading;
      log(`[bike racks] borrowed a ${look.kind}`);
    }
    if (choice.parked || choice.moving) {
      const taken = choice.moving ? trafficSystem.takeCar(cm.entities.person.position.x, cm.entities.person.position.z, 5) : null;
      if (choice.moving && !taken) { cm.entities.person.riding = null; return; }
      const done = parkedCars.take(choice.parked || null, drop);
      if (done?.collider) { allColliders.push(done.collider); cm._colliderCells = null; }
      const look = choice.moving ? taken : done.look;
      const at = choice.moving ? taken : choice.parked;
      cm.restyleCar(look);
      cm.stopCar(car);
      car.position.set(at.x, cm.getGroundHeight(at.x, at.z, 'car', choice.parked ? -Infinity : undefined) + (choice.parked?.y || 0), at.z);
      car.heading = choice.moving ? taken.yaw : choice.parked.yaw;
      car.prevX = car.position.x;
      car.prevZ = car.position.z;
      if (choice.moving) car.speed = taken.speed;
      car.mesh.position.copy(car.position);
      car.mesh.rotation.y = car.heading;
      log(choice.moving ? `[car] took a ${look.kind} out of traffic` : `[car] took a parked ${look.kind}`);
    }
    if (choice.beach) {
      // a kayak off the bank: the player's own goes in the water beside it, facing downstream
      const k = cm.entities.kayak, put = kayakLaunches.take(choice.beach.i);
      cm.dressBoat('kayak');
      liveryPart.made.release();
      docksPart.made.release();
      k.position.set(put.x, put.y ?? k.position.y, put.z);
      k.heading = cm.downstreamHeading(put.x, put.z, k.heading);
      k.speed = k.driftX = k.driftZ = k.turnVel = 0;
      k.mesh.position.copy(k.position);
      k.mesh.rotation.y = k.heading;
      log(`[kayak] put in at ${choice.beach.name}`);
    }
    if (choice.boat) {
      // a kayak or pedal boat from the Gallup Park livery: the player's boat becomes it, there (gallup-livery.js)
      const k = cm.entities.kayak, put = liveryPart.made.take(choice.boat.i);
      cm.dressBoat(put.kind);
      docksPart.made.release();
      k.position.set(put.x, put.y, put.z);
      k.heading = put.heading ?? cm.downstreamHeading(put.x, put.z, k.heading);
      k.speed = k.driftX = k.driftZ = k.turnVel = 0;
      k.mesh.position.copy(k.position);
      k.mesh.rotation.y = k.heading;
      log(`[livery] took a ${put.kind === 'paddleboat' ? 'pedal boat' : 'kayak'}`);
    }
    if (choice.tied) {
      // a boat tied up at a dock: the player's boat becomes it, there, and its spot stands empty (boat-docks.js)
      const k = cm.entities.kayak, put = docksPart.made.take(choice.tied.i);
      cm.dressBoat('kayak');
      liveryPart.made.release();
      k.position.set(put.x, put.y, put.z);
      k.heading = put.heading;
      k.speed = k.driftX = k.driftZ = k.turnVel = 0;
      k.mesh.position.copy(k.position);
      k.mesh.rotation.y = k.heading;
      log(`[docks] took a ${put.kind} off a dock`);
    }
    if (choice.pad) {
      // a helicopter or plane off the airport's apron (airport.js): it's the player's now, and its spot stands empty
      const h = cm.entities.helicopter;
      const was = airportPart.made.take(choice.pad.i);
      airportPart.made.dress(h, was.kind);
      h.position.set(was.x, groundHeight(was.x, was.z) + 0.25, was.z);
      h.heading = was.heading;
      h.speed = h.verticalSpeed = h.pitchAngle = h.rollAngle = 0;
      h.mesh.position.copy(h.position);
      h.mesh.rotation.y = h.heading;
      log(`[airport] took a parked ${was.kind}`);
    }
    if (choice.mode === 'car' && !choice.stairs && !choice.parked && !choice.moving && !choice.rack && !choice.machine &&
      car.machine === 'stairtruck' && !airportPart.made.stairsHeld) airportPart.made.claimStairs?.(car.position.x, car.position.z);
    selectMode(choice.mode);
    if (choice.mode === 'person' && was === 'car' && car.machine === 'stairtruck' && airportPart.made.stairsHeld) parkStairs();
    if (choice.jump) cm.bailOut(choice.jump);
    if (choice.jump === 'chute') {
      const on = input(), key = on.kind === 'keyboard' ? label('Space', on) : label(BUTTON.A, on);
      showNotice(key ? `${key} to open your parachute` : 'Jump to open your parachute', 3);
    }
    const at = cm.getActiveEntity().position;
    if (choice.mode === 'car' || was === 'car') audioSystem.cue('door', at, 0.9);
    savePlayerState();
  }

  function selectCamera(camId, snap = false) {
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
    const short = { chase: 'Chase', action: 'Low angle', pov: 'First person', drone: 'Aerial' }[preset.id] || preset.name;
    const cbName = document.getElementById('cb-camera-name');
    if (cbName) cbName.textContent = short;
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, and the arrows either side of the camera name)
  function cycleCamera(step) {
    const n = CAMERA_PRESETS.length;
    const idx = CAMERA_PRESETS.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(CAMERA_PRESETS[(idx + step + n) % n].id, true);
  }

  // How many people are out: few late at night, busiest from mid-afternoon into the evening, and fewer in rain or snow
  const CROWD_BY_LOOK = { midday: 0.8, golden: 1, twilight: 0.85, midnight: 0.18 };
  function crowdBusy(timeId) {
    if (timeId !== 'now') return CROWD_BY_LOOK[timeId] ?? 0.8;
    const hour = +new Date(Date.now()).toLocaleString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', hourCycle: 'h23' });
    const byHour = [0.2, 0.14, 0.1, 0.06, 0.06, 0.08, 0.2, 0.35, 0.5, 0.55, 0.6, 0.7, 0.8, 0.8, 0.8, 0.9, 1, 1, 1, 1, 0.95, 0.85, 0.6, 0.35];
    const w = lightingSystem.weather;
    const wet = w && /rain|snow|storm|shower|sleet|drizzle/i.test(w.text || '') ? 0.6 : 1;
    const cold = w && w.tempF != null && w.tempF < 25 ? 0.75 : 1;
    return byHour[hour] * wet * cold;
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId, timeId === 'now');
    trafficSystem.setCrowdBusy?.(crowdBusy(timeId));
    // rain or snow falls only under the real sky
    precipitation.set(timeId === 'now' ? lightingSystem.weather : null);
    colorGrade.applyPreset(lightingSystem.lookId);
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
    if (timeId === 'now') describeNow();
  }
  // "Now": Ann Arbor's real sky, its sunrise and sunset worked out here, put on again every minute
  let nowCheckedAt = 0;
  let releaseFrame = 0, freedSinceReport = 0, reportedAt = 0;
  function describeNow() {
    const btn = document.getElementById('time-now');
    if (!btn) return;
    const { rise, set } = sunTimes(Date.now());
    const at = (t) => (t ? new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', minute: '2-digit' }) : '-');
    btn.title = `Now in Ann Arbor · sunrise ${at(rise)}, sunset ${at(set)}`;
    const label = btn.querySelector('.seg-label');
    const w = lightingSystem.weather;
    const temp = w && w.tempF != null ? ` · ${w.tempF}°` : '';
    if (label) label.textContent = `Now · ${at(Date.now())}${temp}`;
    if (w && w.live) btn.title += ` · ${w.text}${w.tempF != null ? `, ${w.tempF}°F` : ''}`;
  }

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]:not(.compact-btn)`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) document.querySelectorAll(`#compact-bar [popovertarget="${pop.id}"]`).forEach((b) => b.classList.remove('is-open'));
      if (!open) return;
      // on a touch screen or in a narrow window every list opens from the one bar at the bottom, lined up under its own button
      const shown = document.getElementById('compact-bar');
      const bar = shown && getComputedStyle(shown).display !== 'none' ? shown : null;
      const barBtn = bar && bar.querySelector(`[popovertarget="${pop.id}"]`);
      const anchor = barBtn ? bar : document.getElementById(pop.dataset.anchor) || invoker;
      const align = barBtn || document.getElementById(pop.dataset.align) || invoker;
      if (barBtn) barBtn.classList.add('is-open');
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      if (barBtn && barBtn.id === 'cb-mode') {
        pop.style.right = 'auto';
        pop.style.left = `${Math.max(8, r.left)}px`;
      } else {
        pop.style.left = 'auto';
        pop.style.right = `${Math.max(8, window.innerWidth - (barBtn ? r.right : align.getBoundingClientRect().right))}px`;
      }
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      travelBy(btn.getAttribute('data-mode'));
    });
  });
  document.querySelectorAll('.pop-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      travelBy(btn.dataset.mode);
      closePopovers();
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
    });
  });

  // The GitHub link: the app around the page opens it in the browser (a link alone goes nowhere in its window)
  document.querySelector('.repo-link')?.addEventListener('click', (e) => {
    if (!window.LampNative?.available) return;
    e.preventDefault();
    window.LampNative.call('openRepo').catch(() => log('[github] the app could not open the link'));
  });

  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  // Where you are: the place's name over its street corner, drawn as a pair of green street-name signs
  const roadNames = new Set(ROADS.map((r) => r.name));
  const placeNames = new Set(LANDMARKS.map((l) => l.name));
  let locationText = '';
  function renderLocation(label) {
    if (!elLocation || label === locationText) return;
    locationText = label;
    let place = '';
    let streets = label;
    const split = label.indexOf(' · ');
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (placeNames.has(label) || (!label.includes(' & ') && !roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'near';
        row.appendChild(near);
      }
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        sign.textContent = name;
        row.appendChild(sign);
      }
      nodes.push(row);
    }
    elLocation.replaceChildren(...nodes);
  }

  // The vehicle's name over the speed
  function setDialName(label) {
    elMode.dataset.label = label;
    elMode.textContent = String(label || '');
    elMode.title = elMode.textContent;
  }

  function teleportTo(x, z, heading = Math.PI, lookUp) {
    const destination = controllerManager.teleportActiveTo(x, z, heading);
    log(`[teleport] asked ${x.toFixed(1)}, ${z.toFixed(1)} → landed ${destination.x.toFixed(1)}, ${destination.z.toFixed(1)} as ${controllerManager.activeMode}`);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    // a tall landmark's viewpoint looks up at it, until the player moves off
    if (Number.isFinite(lookUp)) cameraSystem.lookUp = lookUp;
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      name: getLocationLabel(destination.x, destination.z)
    };
    return destination;
  }

  const mapSystem = new CityMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    allBlocks: cityBlocks.allBlocks,
    onToggle: (open) => {
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Tap to teleport · Drag to pan · Use + / − to zoom';
      }
    },
    onTeleport: teleportTo
  });
  // the road work on the maps: the middle of each closed block
  mapSystem.workSites = (roadWork?.closures || []).map((e) => ({ x: e.sx + e.dx * e.len / 2, z: e.sz + e.dz * e.len / 2 }));

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      const loc = TELEPORT_LOCATIONS[key];
      if (loc) {
        // a place to arrive at on foot (the Cube, to push it)
        if (loc.foot && controllerManager.activeMode !== 'person') selectMode('person');
        teleportTo(loc.x, loc.z, loc.heading, loc.lookUp);
      }
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'Show HUD' : 'Hide HUD');
      hudToggleBtn.title = isMin ? 'Show the HUD [H]' : 'Clean view: hide the HUD [H]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for modes (1-5), getting in and out (F), cameras (V / 6-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    switch (e.code) {
      case 'Digit1':
        travelBy('person');
        break;
      case 'Digit2':
        travelBy('car');
        break;
      case 'Digit3':
        travelBy('cyclist');
        break;
      case 'Digit4':
        travelBy('helicopter');
        break;
      case 'Digit5':
        travelBy('kayak');
        break;
      case 'Digit6':
        selectCamera('chase', true);
        break;
      case 'Digit7':
        selectCamera('action', true);
        break;
      case 'Digit8':
        selectCamera('pov', true);
        break;
      case 'Digit9':
        selectCamera('mainStreet', true);
        break;
      case 'Digit0':
        selectCamera('stateLiberty', true);
        break;
      case 'KeyF':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) getInOrOut();
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyN':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) audioSystem.setEnabled(!audioSystem.enabled);
        break;
      case 'KeyR':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) carRadio.tune(e.shiftKey ? -1 : 1);
        break;
      case 'KeyB':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !mapSystem.isFullMapOpen) audioSystem.honk(controllerManager.getActiveEntity());
        break;
    }
  });

  window.addEventListener('resize', () => {
    placeModeIndicator();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  });

  // Initialize the UI and chase camera around the restored player, or the default taxi on a first visit.
  selectMode(controllerManager.activeMode);
  // The HUD names what the player is holding, and changes as soon as they pick up something else.
  onInput((on) => {
    relabelKeys(on);
    renderControlHints(controllerManager.activeMode, on);
    touchControls.updateAvailability();
    placeModeIndicator();
  });
  selectCamera('chase', true);
  // Lamp: Ann Arbor's weather now (weather.js), on the "Now" sky and falling around the camera; asked for again every
  // 15 minutes of play
  let weatherAskedAt = -Infinity;
  const askWeather = (elapsed) => {
    weatherAskedAt = elapsed;
    fetchWeather().then((w) => {
      lightingSystem.weather = w;
      log(`[weather] ${w.live ? 'Ann Arbor now' : 'offline, so'}: ${w.text}${w.tempF != null ? `, ${w.tempF}°F` : ''}`);
      if (lightingSystem.activePresetId === 'now') selectTime('now');
    });
    // the Huron's flow at the USGS gauge, which the kayak's current follows
    // PFAS in the Huron by town, from the state's sampling: how much foam drifts on it
    fetchRiverPfas().then((r) => {
      waterDisturb.pfas.value = r.foam;
      log(`[pfas] ${r.live ? 'state data' : 'offline, so the last known reading'}: PFOS ${r.detected ? r.ppt : `under ${r.ppt * 2}`} ppt at ${r.site} (${r.date}), foam ${r.foam.toFixed(2)}`);
    });
    fetchRiverFlow().then((r) => {
      controllerManager.riverScale = r.scale;
      log(`[river] ${r.live ? `Huron at Ann Arbor now: ${Math.round(r.cfs)} cubic feet a second` : 'offline, so its usual flow'}, current ×${r.scale.toFixed(2)}`);
    });
  };
  selectTime('now');
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // Compile shaders behind the loading screen. Overlapping compileAsync() jobs keep compilation moving
  // while individual jobs yield to the browser.
  const COMPILE_POOL = 16;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
    await showLoadingStage('Preparing reflections and bloom...');
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    markInit('postFX');

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own unless its chunks share a pipeline
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    const pipelines = new Set();
    scene.traverseVisible((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      // Use the first visible chunk: the original representative may be in an inactive tree cell. Shadow stand-ins
      // only draw in the shadow maps (the warm-up frame compiles those).
      if (o.userData.shadowProxy) return;
      const pipeline = o.userData.sharesPipelineWith || o;
      if (pipelines.has(pipeline)) return;
      pipelines.add(pipeline);
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    await showLoadingStage(`Compiling scene shaders... 0 / ${jobs.length} batches`);
    setLoadingProgress(0);
    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(sceneMRT);
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) await compile(object);
        done++;
        if (loadingStatus) {
          loadingStatus.textContent = `Compiling scene shaders... ${done} / ${jobs.length} batches (${Math.round((done / jobs.length) * 100)}%)`;
        }
        setLoadingProgress(done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
  }

  // Lamp's preview plays out of sight, frame by frame, with no screen to wait for: the warm-up frame compiles there.
  if (!window.lampPreview && !warmStart) await precompileShaders();
  markInit('compile');
  await showLoadingStage('Preparing shadows and the first frame...');

  // 6. The frame, which Lamp's runtime calls about 60 times a second (and its preview at exactly 1/60 s)
  let elapsed = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let heardStrokes = 0;
  const cubeCtx = { keys: controllerManager.keys, player: null, heading: 0, cue: (k, at, i) => audioSystem?.cue(k, at, i), grind: (w, at) => audioSystem?.cubeGrind(w, at) };
  const animalCtx = { camera: cameraSystem.camera, player: null, mode: 'car', look: 'midday', cars: trafficSystem.cars, buses: trafficSystem.buses, paddlers: riverPeoplePart.made.people || [], colliders: allColliders, cue: (k, at, i) => audioSystem?.cue(k, at, i) };
  let warmedUp = false; // see the first frame below

  if (elFps) elFps.textContent = '60';

  // Lamp: what each frame's work costs on this machine, logged every ten seconds (milliseconds a frame on average, and
  // the draws and triangles a frame), to see what slows it down
  const prof = { t: 0, n: 0, parts: new Map(), draws: 0, tris: 0, next: 10 };
  let profAt = 0;
  const mark = (name) => {
    const t = performance.now();
    prof.parts.set(name, (prof.parts.get(name) || 0) + (t - profAt));
    profAt = t;
  };
  renderer.info.autoReset = false;

  const frame = (f) => {
    profAt = performance.now();
    renderer.info.reset();
    const now = f.time * 1000;
    const rawDt = f.dt;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsed += dt;
    tickNotice(dt);
    knockdowns.update(dt);
    hydrantSpray.update(dt, cameraSystem.camera);
    audioSystem?.gush?.(hydrantSpray.gushes(gushList));
    skidEffects.update(dt, controllerManager.entities.car, controllerManager.activeMode === 'car', cameraSystem.camera);

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    gamepadControls.supply(f.pads[0]);
    gamepadControls.update(dt);
    controllerManager.update(dt, elapsed, cameraSystem.initialized ? cameraSystem.currentPos : null);
    {
      const cm = controllerManager, look = cm.carLook;
      const mode = cm.activeMode, inCar = mode === 'car' && !cm.entities.car.bike;
      carRadio.update(dt, { inCar, carKey: look && `${look.kind}:${look.hex}:${look.style ?? 0}`,
        own: Boolean(look && isOwnLook(look)), phones: !inCar && mode !== 'helicopter', soundOn: audioSystem.enabled });
      cm.earbuds = carRadio.earbuds; // white earbuds on the player while one plays (controllers.js)
    }
    // parked cars a crash shoved, sliding to a stop (parked-cars.js), and found where they are now
    for (const col of parkedCars.step(dt, (p) => controllerManager.settleParked(p))) controllerManager.refreshCollider(col);
    {
      const cm = controllerManager, mode = cm.activeMode;
      const ent = mode === 'car' ? cm.entities.car : mode === 'cyclist' ? cm.entities.cyclist : mode === 'person' ? cm.entities.person : null;
      const hit = waterSplash.track(ent, mode === 'car' ? (ent.bike ? 'bike' : 'car') : mode, dt);
      if (hit) {
        audioSystem.cue(hit.in ? 'plunge' : 'splash', hit, hit.in ? hit.strength : 0.6 + hit.strength * 0.4);
        if (hit.in) rumble(0, 0.5 * hit.strength, 0.8 * hit.strength, 0.3);
        log(`[splash] ${hit.in ? 'into' : 'out of'} the river at ${Math.round(hit.strength * 100)}%`);
      }
      waterSplash.update(dt, cameraSystem.camera);
    }
    cameraSystem.update(dt, elapsed);
    tickRecording(dt);
    // the camera under the river's surface: murky green fog and a tint over the view
    {
      const cp = cameraSystem.camera.position, level = waterLevel(cp.x, cp.z);
      // (the river's level runs on over the land beside it, so only where the river really is: not in the stadium's bowl)
      const under = level != null && riverDepth(cp.x, cp.z) > 0.08 && cp.y < level - 0.05 && groundHeight(cp.x, cp.z) < level ? 1 : 0;
      if (lightingSystem.uUnder) lightingSystem.uUnder.value = under;
      if (under !== lastUnder) {
        lastUnder = under;
        underwaterEl.style.opacity = under ? '1' : '0';
        log(under ? '[underwater] the camera went under the river' : '[underwater] the camera came up');
      }
    }
    streetDetails.signalClock.value = elapsed;
    controlsPart.made.update(elapsed);
    trafficSystem.update(
      dt,
      elapsed,
      cameraSystem.currentPos,
      controllerManager.getActiveEntity(),
      controllerManager.activeMode,
      cameraSystem.camera
    );
    mark('player & traffic');
    highwayTraffic.update(dt, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode);
    mark('highway');
    railways.update(dt, (at) => audioSystem.trainHorn(at));
    parkedCars.update(cameraSystem.camera);
    roadWork.update(dt, controllerManager.getActiveEntity(), controllerManager.activeMode, trafficSystem.cars, trafficSystem.buses);
    riverPeoplePart.made.update(dt, elapsed, cameraSystem.currentPos);
    liveryPart.made.update(dt, elapsed, cameraSystem.currentPos,
      controllerManager.activeMode === 'person' ? controllerManager.entities.person.position : null);
    planesPart.made.update(dt);
    scootersPart.made.update(dt, cameraSystem.currentPos);
    racksPart.made.update(dt, cameraSystem.currentPos);
    airportPart.made.update?.(dt, cameraSystem.currentPos);
    {
      // the truck the player drove the airstairs as is hidden while the airstairs it left stand in its place
      const c = controllerManager.entities.car;
      if (c.machine === 'stairtruck' && controllerManager.activeMode !== 'car' && !airportPart.made.stairsHeld) {
        c.mesh.visible = !airportPart.made.nearestStairs?.(c.position.x, c.position.z, 1);
      }
    }
    moonPart.made.update(cameraSystem.camera);
    mark('trains & parked');
    animalCtx.player = controllerManager.getActiveEntity();
    animalCtx.mode = controllerManager.activeMode;
    animalCtx.look = lightingSystem.lookId;
    animalCtx.paddlers = riverPeoplePart.made.people || animalCtx.paddlers;
    animalsPart.made.update(dt, elapsed, animalCtx);
    mark('animals');
    cubeCtx.player = animalCtx.player.position;
    cubeCtx.heading = animalCtx.player.heading;
    cubePart.made.update(dt, cubeCtx);
    // the dial's name follows whatever the player is in, however they got into it
    const dialLabel = controllerManager.getActiveEntity()?.label;
    if (elMode && dialLabel && dialLabel !== elMode.dataset.label) setDialName(dialLabel);
    const kayak = controllerManager.entities.kayak;
    if (kayak.strokes !== heardStrokes) {
      heardStrokes = kayak.strokes;
      if (controllerManager.activeMode === 'kayak') audioSystem.cue('splash', kayak.position, 0.8);
    }
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    if (outskirts.update) outskirts.update(elapsed);
    mark('misc');
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    if (cityBlocks.updateLights) cityBlocks.updateLights(cameraSystem.camera);
    mark('blocks');
    if (streetDetails.update) streetDetails.update(cameraSystem.camera);
    mark('street details');
    lightingSystem.update(cameraSystem.currentPos);
    mapSystem.update();
    if (lightingSystem.activePresetId === 'now' && elapsed - nowCheckedAt > 60) {
      nowCheckedAt = elapsed;
      selectTime('now');
    }
    if (elapsed - weatherAskedAt > 900) askWeather(elapsed);
    precipitation.update(cameraSystem.camera, elapsed);
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.lookId === 'midnight');
    {
      const car = controllerManager.entities.car;
      const driving = controllerManager.activeMode === 'car' && car;
      audioSystem.tireSkid(driving ? car.skid || 0 : 0, driving ? Math.abs(car.speed) : 0);
    }
    mark('light, map, weather, sound');
    if (warmedUp) updateSceneCulling(cameraSystem.camera.position); // the warm-up frame draws every chunk
    if (TIER.stream) {
      const { x, z } = cameraSystem.camera.position;
      updateGroundStreaming(x, z);
      houseStream?.update(x, z);
    }
    // the still parts' script copies let go once uploaded; the memory logged again once they've mostly gone
    if (warmedUp && (++releaseFrame & 31) === 0) {
      freedSinceReport += releaseUploaded(renderer);
      if (MEASURE_MEMORY && freedSinceReport > 0 && elapsed - reportedAt > 12) {
        reportedAt = elapsed; freedSinceReport = 0;
        reportMemory(scene, renderer, log, TIER.name !== 'full');
      }
    }
    // Traffic collisions can move the player after controller updates; finalize moving hierarchies here.
    for (const root of dynamicRoots) root.updateMatrixWorld();
    mark('culling');

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp && !warmStart) {
      // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
      // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
      // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
      const culled = [];
      const pipelines = new Set();
      scene.traverseVisible((o) => {
        const pipeline = o.userData.sharesPipelineWith || o;
        if (pipelines.has(pipeline)) return;
        pipelines.add(pipeline);
        if (o.frustumCulled) {
          culled.push(o);
          o.frustumCulled = false;
        }
      });
      renderPipeline.render();
      for (const o of culled) o.frustumCulled = true;
      markInit('warmup');
    }
    renderPipeline.render();
    mark('render');
    prof.n++;
    prof.draws += renderer.info.render.drawCalls;
    prof.tris += renderer.info.render.triangles;
    if (elapsed >= prof.next && warmedUp) {
      prof.next = elapsed + 10;
      const parts = [...prof.parts].map(([k, v]) => `${k} ${(v / prof.n).toFixed(1)}`).join(', ');
      log(`[frame] ms a frame: ${parts}; ${Math.round(prof.draws / prof.n)} draws, ${(prof.tris / prof.n / 1e6).toFixed(2)}M triangles`);
      prof.parts.clear(); prof.n = prof.draws = prof.tris = 0;
    }
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
      // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
      // compiled), i.e. until the city is actually on screen
      const device = renderer.backend.device;
      if (loadingStatus) loadingStatus.textContent = 'Waiting for graphics to finish the first frame...';
      Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {}).then(() => {
        markInit('gpu');
        log(`[init] ${initTimings.join(', ')}`);
        initTimings = null;
        // Lamp's preview draws no frames on a screen, so a fade would never finish there: it goes at once.
        if (loadingOverlay && window.lampPreview) loadingOverlay.style.transition = 'none';
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        warm.compiled = true;
        audioSystem.ready = true;
        // Lamp: the Mac app lets the page play sound unasked, so the city is heard as it appears, not at the first key
        audioSystem.unlock();
        setLoadingProgress(1);
      });
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    hud.clock += Math.max(0, rawDt);
    // The speed, the needle and the gear follow every frame, not the slower telemetry below
    {
      const ent = controllerManager.getActiveEntity();
      const dialMode = controllerManager.activeMode;
      // the gear and revs only for an engine that turns wheels (not the helicopter, the kayak, a hoverboard or a bicycle)
      const geared = dialMode === 'car' && ent.gears !== false ? '1' : '';
      if (document.body.dataset.geared !== geared) document.body.dataset.geared = geared;
      if (document.body.dataset.mode !== dialMode) document.body.dataset.mode = dialMode;
      const mphExact = (dialMode === 'kayak' ? ent.groundSpeed || 0 : Math.abs(ent.speed)) * 2.237;
      const mph = Math.round(mphExact);
      if (elSpeed && mph !== hud.shownMph) { hud.shownMph = mph; elSpeed.textContent = String(mph); }
      if (elSpeedMeter && dialScale.max) {
        elSpeedMeter.style.transform = `scaleX(${Math.min(1, mphExact / dialScale.max)})`;
      }
      // the gear and revs are worked out ten times a second, which is the rate the engine sound reads them at
      if (geared && elGear && hud.clock - hud.lastClock >= 0.1) {
        const read = gearReadout(Math.abs(ent.speed), ent.speed >= 0);
        if (read.gear !== hud.shownGear) { hud.shownGear = read.gear; elGear.textContent = read.gear; }
        if (elRpm && read.rpm !== hud.shownRpm) { hud.shownRpm = read.rpm; elRpm.textContent = String(read.rpm); }
      }
    }
    if (fpsTimer >= 0.25) {
      const currentFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mode = controllerManager.activeMode;
      // Lamp: height above the ground below (terrain.js)
      const altFt = Math.max(0, Math.round((activeEnt.position.y - groundHeight(activeEnt.position.x, activeEnt.position.z)) * 3.281));

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = currentFps >= 50 ? 'fps-ok' : currentFps >= 30 ? 'fps-warn' : 'fps-bad';
      }
      const jumping = !!controllerManager.exitJump();
      if (jumping !== jumpOut) {
        jumpOut = jumping;
        renderControlHints(mode);
        touchControls.setGetOutWords(mode === 'person' ? 'Get in' : jumping ? 'Jump out' : 'Get out');
      }
      buildDial(mode, activeEnt.drive);
      if (elAltitude) elAltitude.textContent = altFt.toLocaleString('en-US');
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      renderLocation(getLocationLabel(where.x, where.z));
    }
  };

  // The city reads its own keys and draws its own touch controls; a controller, and the preview's moves, come as the
  // first pad. The canvas goes back under the HUD, where the page laid it out.
  // Lamp: where the player is, kept through a change Lamp makes while the city is played (lamp-game.js, "Changes while
  // it's played"): the mode, where each of the person, car, bike and helicopter is, which way it faces and how fast it
  // goes, the camera and its zoom, the time of day, and whether the full map is open and the HUD hidden. The new code
  // starts from it once it has built the city, before its first frame; a field an older snapshot lacks keeps its
  // start value.
  function snapshot() {
    const entities = Object.fromEntries(Object.entries(controllerManager.entities).map(([mode, entity]) => [mode, {
      x: entity.position.x, y: entity.position.y, z: entity.position.z, heading: entity.heading, speed: entity.speed || 0
    }]));
    return { version: 2, activeMode: controllerManager.activeMode, entities, camera: cameraSystem.activePresetId,
             zoom: cameraSystem.zoomMultiplier, time: lightingSystem.activePresetId,
             map: mapSystem.isFullMapOpen, hudHidden: document.body.classList.contains('hud-minimized') };
  }
  function startFrom(state) {
    if (state?.version !== 2) return;
    for (const mode of Object.keys(controllerManager.entities)) {
      const p = state.entities?.[mode];
      if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
      controllerManager.setMode(mode);
      controllerManager.teleportActiveTo(p.x, p.z, p.heading, p.y);
      if (Number.isFinite(p.speed)) controllerManager.entities[mode].speed = p.speed;
    }
    selectMode(Object.hasOwn(controllerManager.entities, state.activeMode) ? state.activeMode : controllerManager.activeMode);
    if (state.time) selectTime(state.time);
    if (state.camera) selectCamera(state.camera, true);
    if (Number.isFinite(state.zoom)) cameraSystem.zoomMultiplier = state.zoom;
    if (typeof state.hudHidden === 'boolean') hudChosen = true;
    if (typeof state.hudHidden === 'boolean' && hudToggleBtn && state.hudHidden !== document.body.classList.contains('hud-minimized')) hudToggleBtn.click();
    if (state.map === true) mapSystem.toggleFullMap(true);
  }

  // sharp: drawing smaller never made frames faster here (the log showed it undone every time), it only blurred the city
  game({ renderer, init() {
    // a phone draws fewer pixels, and smaller still if frames come slow
    if (TIER.scale < 1) renderer.setSize(Math.round(1920 * TIER.scale), Math.round(1080 * TIER.scale), false);
    const was = pendingRestore(); if (was) startFrom(was);
  }, frame, touch: false, keyboard: false, snapshot, sharp: TIER.name !== 'phone',
    // What this run made that no part keeps goes with it: the map and the camera system are made afresh by the next.
    dispose() { cameraSystem.release(); mapSystem.release(); renderPipeline.dispose(); colorGrade.dispose(); ssrPass?.dispose(); scenePass.dispose(); } });
  container.appendChild(renderer.domElement);
}

initApp();
