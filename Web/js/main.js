// Lamp's game runtime first: in Lamp's preview it sets the clock and random numbers before anything reads them.
import { game, hot, save, load, log, asset, input, onInput, label, glyph, pendingRestore, rumble, BUTTON, STICK, TRIGGER } from '../lamp-game.js';
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, vec3, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { createPostProcessing } from './post-processing.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { CarRadio } from './radio.js';
import { CAR_RATIOS, newGearState, shiftGear, engineRPM } from './gearbox.js';
import { getLocationLabel, isTypingInField, ROADS, LANDMARKS, TELEPORT_LOCATIONS } from './city-config.js';
import { buildKayakLaunches } from './kayak-launches.js';
import { buildLivery } from './gallup-livery.js';
import { buildCityGrid, restoreCityGrid } from './city-grid.js';
import { buildOutskirts, paintTown } from './outskirts.js';
import { buildLandmarks } from './landmarks.js';
import { buildRailways } from './railways.js';
import { pumpSpots } from './gas-stations.js';
import { buildParkedCars } from './parked-cars.js';
import { buildCityBlocks } from './buildings.js';
import { setDistricts, setNeighborhoods } from './districts.js';
import { setRoofShapes, setBuildingLooks } from './houses.js';
import { buildStreetDetails } from './street-details.js';
import { createTrafficSystem, createHighwayTraffic, freewayLanes, VEHICLE_RADIUS } from './traffic.js';
import { loadCityClosures } from './city-closures.js';
import { buildRoadPaint } from './road-paint.js';
import { buildTrafficControls } from './traffic-controls.js';
import { buildShopSigns } from './shop-signs.js';
import { setShopTypes } from './shop-types.js';
import { createShopInteriors } from './shop-interiors.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { reportTriangles, showTriangles } from './triangle-report.js';
import { reportMemory, memoryCheckpoint, MEASURE_MEMORY } from './memory-report.js';
import { gpuOnly, releaseUploaded, useRenderer } from './gpu-only.js';
import { TIER, XBOX, QUALITY_CHOOSABLE, qualityChoice, setQualityChoice } from './device-tier.js';
import { FILLS, fillWindow, stageSize } from './stage.js';
import { GolfPlay } from './golf-play.js';
import { GamepadControls } from './gamepad-controls.js';
import { createSecondPlayer, createSplitView } from './split-screen.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem, sunTimes } from './lighting.js';
import { createKnockdowns } from './knockdowns.js';
import { createHydrantSpray } from './hydrant-spray.js';
import { createWaterSplash } from './water-splash.js';
import { createSkidEffects } from './skid-effects.js';
import { CityMapSystem } from './city-map.js';
import { setupSceneCulling, updateSceneCulling, cullAlso, showShadowStandIns } from './scene-culling.js';
import { loadTerrain, setPools, setOnTerrain, groundHeight, waterLevel, riverDepth, streamGround, updateGroundStreaming, putStreamedGround, streamNear, groundStreamCenter } from './terrain.js';
import { loadYardData, allYards } from './yards.js';
import { buildCascades, CASCADE_START } from './cascades.js';
import { buildRiverPeople } from './river-people.js';
import { buildAnimals } from './animals.js';
import { buildBandShell } from './band-shell.js';
import { buildRestrooms } from './restrooms.js';
import { buildDraftedHouses } from './drafted-houses.js';
import { buildHelipads } from './helipads.js';
import { speedLimitAt } from './speed-limits.js';
import { townTime, crowdShares, trafficShare } from './town-clock.js';
import { createSeats } from './seats.js';
import { CityAudioSystem } from './audio-system.js';
import { fetchWeather, createPrecipitation } from './weather.js';
import { setRoadWeather } from './road-feel.js';
import { createFallingLeaves } from './falling-leaves.js';
import { createOutdoors } from './outdoors.js';
import { fetchRiverFlow } from './river-gauge.js';
import { fetchRiverPfas } from './river-pfas.js';
import { createPlanes } from './planes.js';
import { createAirport, onAirfield, PAVE } from './airport.js';
import { createScooters } from './scooters.js';
import { buildBikeRacks } from './bike-racks.js';
import { probe, gpuTimer } from './gpu-probe.js';
import { buildPools } from './pools.js';
import { buildOutdoorSeating } from './outdoor-seating.js';
import { setStreetLife } from './street-life.js';
import { setSitSpots } from './pedestrian-system.js';
import { buildBallDiamonds } from './ball-diamonds.js';
import { buildFootballFields } from './football-fields.js';
import { buildBleachers } from './bleachers.js';
import { buildBoatDocks } from './boat-docks.js';
import { buildSkatePark } from './skate-park.js';
import { buildParkingStructures } from './parking-structures.js';
import { buildMtbTrails } from './mtb-trails.js';
import { buildBikeRoutes } from './bike-routes.js';
import { buildB2BTrail } from './b2b-trail.js';
import { B2B_NAME, onB2B } from './b2b-route.js';
import { dressForSnow, loadSnowCover } from './snow-cover.js';
import { createMoon } from './moon.js';
import { createStars } from './sky-stars.js';
import { waterDisturb, setShopHour } from './tsl-materials.js';
import { refreshSeason } from './seasons.js';
import { buildRoadWork } from './road-work.js';
import { buildPotholes } from './potholes.js';
import { buildSpeedHumps } from './speed-humps.js';
import { buildCurbCarts, cartDay } from './curb-carts.js';
import { CHAMPION_TREES } from './champion-trees.js';
import { VideoRecorder } from './recorder.js';
import { createGroundShade } from './ground-shade.js';

// the code and its data in (index.html says so on the loading screen when they don't come)
window.cityCodeLoaded = true;

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
// how many times the code has run in this page (more than once after a change while it's played: see watchWork)
const liveRuns = live.keep('liveRuns', () => ({ n: 0 }));
liveRuns.n++;

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
  // (a passing error while the code came in may have hidden it: index.html)
  if (loadingTrack) loadingTrack.style.visibility = '';
  // the city's road closures asked for now, while the city builds, and waited for only where traffic is built
  const closuresReady = loadCityClosures().catch(() => null);
  // Only shader compilation has measurable progress; other stages use the sweeping bar.
  const setLoadingProgress = (p) => {
    if (!loadingFill) return;
    if (loadingTrack) loadingTrack.classList.remove('is-indeterminate');
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };

  // The words over everything once the graphics are gone (see the renderer below)
  function graphicsGone(why) {
    log(`[device] graphics lost (${why})`);
    if (document.getElementById('graphics-gone')) return;
    const d = document.createElement('div');
    d.id = 'graphics-gone';
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#0d1117;color:#fff;font:600 44px system-ui,sans-serif;text-align:center;padding:60px';
    d.innerHTML = '<div>The graphics stopped</div><div style="font-weight:400;font-size:30px;opacity:.75;max-width:1100px">Close Go To Ann Arbor and open it again. You\'ll be back where you were.</div>';
    document.body.appendChild(d);
  }

  // Lamp: a start with the renderer kept (see the top of this file) shows no loading screen and doesn't wait for it
  let warmStart = false;
  let paintedAt = -Infinity;
  async function showLoadingStage(message) {
    if (loadingStatus) loadingStatus.textContent = message;
    if (loadingTrack) loadingTrack.classList.add('is-indeterminate');
    if (document.hidden || warmStart) return;
    // (a frame waited for only when the last label has been up a while: each wait is a frame and a timer, and a
    // label shown for less than that isn't read)
    if (performance.now() - paintedAt < 150) return;
    // Let the label paint before synchronous work. The timeout also lets hidden tabs keep loading.
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 100);
      requestAnimationFrame(() => {
        clearTimeout(timeout);
        setTimeout(resolve, 0);
      });
    });
    paintedAt = performance.now();
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
    ao: !!TIER.ao,
    outskirts: TIER.outskirts
  };
  // Kept through a change: a new one would compile every shader again.
  const renderer = await live.keep('renderer', async () => {
    const made = new THREE.WebGPURenderer({ antialias: QUALITY.antialias, powerPreference: 'high-performance', reversedDepthBuffer: true, forceWebGL: true });
    try {
      await made.init();
    } catch (e) {
      // no WebGL at all: the browser shuts the page out of 3D after its graphics were lost, until the app opens again
      graphicsGone('no WebGL: ' + e.message);
      throw e;
    }
    return made;
  });
  // The graphics lost (the Xbox drops the page's GPU context when it runs short, e.g. while a change builds most of
  // the city again beside the old one): three.js then draws nothing for good, a black screen at 60 fps. Opening the
  // page again doesn't help (its browser then refuses WebGL to the page until the app itself is opened again), so it
  // says so on screen.
  renderer.onDeviceLost = (info) => { renderer._isDeviceLost = true; graphicsGone(info?.message || 'no reason given'); };
  if (renderer._isDeviceLost) graphicsGone('lost before this change');
  useRenderer(renderer);
  // once a page: which GPU WebGL draws with and how fast its JavaScript runs (gpu-probe.js)
  probe(renderer);
  const gpuTime = gpuTimer(renderer);
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
  const fallingLeaves = createFallingLeaves(); // leaves coming down in the fall (falling-leaves.js)
  scene.add(fallingLeaves.mesh);
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
  const racksPart = await live.keep('bikeRacks', () => cityPart((g) => buildBikeRacks(g), { cull: setupSceneCulling }), { inputs: [heights], from: ['js/bike-racks.js', 'data/bike-racks.json'] });
  // the town's outdoor swimming pools, to swim in, and to sink a car in (pools.js); their water is the river's kind
  const poolsPart = await live.keep('pools', () => cityPart((g) => buildPools(g), { cull: setupSceneCulling }), { inputs: [heights], from: ['js/pools.js', 'data/pools.json'] });
  setPools(poolsPart.made);
  // the tables and chairs out on the patios and the sidewalks in front of the cafes, restaurants and bars (outdoor-seating.js)
  const seatingPart = await live.keep('outdoorSeating', () => cityPart((g) => buildOutdoorSeating(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/outdoor-seating.js', 'data/outdoor-seating.json'] });
  // the baseball and softball diamonds in the parks and at the schools (ball-diamonds.js)
  const diamondsPart = await live.keep('ballDiamonds', () => cityPart((g) => buildBallDiamonds(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/ball-diamonds.js', 'data/ball-diamonds.json'] });
  const footballPart = await live.keep('footballFields', () => cityPart((g) => buildFootballFields(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/football-fields.js'] });
  // the bleachers by the fields and tracks (bleachers.js)
  const bleachersPart = await live.keep('bleachers', () => cityPart((g) => buildBleachers(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/bleachers.js', 'data/bleachers.json'] });
  // the docks and boat launches on the river and its ponds, with boats tied up (boat-docks.js)
  const docksPart = await live.keep('boatDocks', () => cityPart((g) => buildBoatDocks(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/boat-docks.js', 'data/boat-docks.json'] });
  // the Ann Arbor Skatepark in Veterans Memorial Park (skate-park.js)
  const skatePart = await live.keep('skatePark', () => cityPart((g) => buildSkatePark(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/skate-park.js', 'data/skate-park.json'] });
  // what's on the mountain bike trails: rocks, roots, logs, berms, tabletops and trail posts (mtb-trails.js)
  const mtbPart = await live.keep('mtbTrails', () => cityPart((g) => buildMtbTrails(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/mtb-trails.js', 'data/mtb-trails.json'] });
  // the Border to Border Trail's fresh asphalt and centre line, its wayfinding signs and markers (b2b-trail.js)
  const b2bPart = await live.keep('b2bTrail', () => cityPart((g) => buildB2BTrail(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/b2b-trail.js', 'js/b2b-route.js', 'js/b2b-data.js'] });
  // Ann Arbor Municipal Airport south of town, with helicopters parked by the FBO to fly (airport.js)
  const airportPart = live.keep('airport', () => cityPart((g) => createAirport(g)), { inputs: [heights], from: ['js/airport.js', 'js/airport-data.js'] });
  // Lamp: the moon in its real phase (moon.js)
  const moonPart = live.keep('moon', () => cityPart((g) => createMoon(g)), { from: ['js/moon.js'] });
  // the stars where they really are over Ann Arbor at the game's time (sky-stars.js)
  const starsPart = live.keep('stars', () => cityPart((g) => createStars(g)), { from: ['js/sky-stars.js', 'js/star-catalog.js'] });
  // how dark the sky is round a camera: the town's glow washes out the faint stars downtown, less out in the country
  // or high up (0 downtown, 1 dark)
  const starsAt = (cam) => {
    const p = cam.position, away = Math.hypot(p.x, p.z);
    const dark = Math.max(Math.min(1, Math.max(0, (away - 2500) / 4000)), Math.min(1, Math.max(0, (p.y - 150) / 600)));
    return { night: lightingSystem.uNightFactor.value, cover: lightingSystem.sky.cloudCoverage.value, dark, time: performance.now() / 1000 };
  };
  await showLoadingStage('Laying out the hills of Washtenaw County...');
  const outskirtsPart = live.keep('outskirts', () => cityPart((g) => buildOutskirts(g), { cull: setupSceneCulling, still: true }),
    { inputs: [heights, grid], from: ['js/outskirts.js'] });
  const outskirts = outskirtsPart.made;
  markInit('outskirts');
  await showLoadingStage('Building the Big House...');
  const landmarks = live.keep('landmarks', () => cityPart((g) => buildLandmarks(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: [CITY_MAP, 'js/stadium-geodata.js', 'js/campus-landmarks.js', 'js/merge-static.js', 'js/landmarks.js'] });
  // the parking structures, to drive up floor by floor; they stand in for the survey's blocks (parking-structures.js)
  const parkingPart = await live.keep('parkingStructures', () => cityPart((g) => buildParkingStructures(g), { cull: setupSceneCulling, still: true }),
    { inputs: [heights], from: ['js/parking-structures.js', 'data/parking-structures.json'] });
  // the West Park Band Shell, closed and fenced in, in place of the survey's block (band-shell.js)
  const bandShellPart = live.keep('bandShell', () => cityPart((g) => buildBandShell(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/band-shell.js'] });
  // the town's public restrooms and portable toilets, where the map has them (restrooms.js)
  const restroomsPart = await live.keep('restrooms', () => cityPart((g) => buildRestrooms(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/restrooms.js', 'data/restrooms.json'] });
  // houses drafted from street photos by Open Facades, each in place of the survey's block where it really stands (drafted-houses.js)
  const draftedPart = await live.keep('draftedHouses', () => cityPart((g) => buildDraftedHouses(g), { cull: setupSceneCulling, still: true }), { inputs: [heights], from: ['js/drafted-houses.js', 'js/drafted/spec-render.js', 'js/drafted/generator.js', 'js/drafted-yards.js', 'data/drafted-houses.json'] });
  const landmarkColliders = [...landmarks.made.colliders, ...parkingPart.made.colliders, ...bandShellPart.made.colliders, ...restroomsPart.made.colliders, ...draftedPart.made.colliders];
  markInit('landmarks');
  await showLoadingStage('Generating building footprints and facades...');
  // house numbers by the front doors (build-addresses.py, the city's Address Points)
  // the city's land use and historic districts (build-districts.py): building looks and the location label ask them
  const districtBytes = await asset('data/districts.json');
  setDistricts(districtBytes ? JSON.parse(new TextDecoder().decode(districtBytes)) : null);
  const hoodBytes = await asset('data/neighborhoods.json'); // the city's neighbourhoods, for the label and the map
  setNeighborhoods(hoodBytes ? JSON.parse(new TextDecoder().decode(hoodBytes)) : null);
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
  // what kind of business each named storefront is (build-shop-types.py), before the shop walls are built
  const shopTypeBytes = await asset('data/shop-types.json');
  setShopTypes(shopTypeBytes ? JSON.parse(new TextDecoder().decode(shopTypeBytes)) : null);
  const blocks = live.keep('blocks', () => cityPart((g) => buildCityBlocks(g, landmarkColliders, addresses, gasStations), { cull: setupSceneCulling, still: true }),
    { inputs: [heights, landmarks, parkingPart, bandShellPart, restroomsPart, draftedPart], from: [CITY_MAP, ...BUILDING_DATA, 'data/addresses.json', 'data/districts.json', 'data/gas-stations.json', 'data/roof-shapes.json', 'data/building-looks.json', 'data/shop-types.json', 'js/shop-types.js', 'js/building-footprints.js', 'js/houses.js', 'js/trees.js'] });
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
    const made = buildStreetDetails(g, allColliders, streetFurniture, parkingPart.made.inside, draftedPart.made.yard || []);
    await setOnTerrain(g.getObjectByName('StreetDetails'));
    return made;
  }, { cull: setupSceneCulling, still: true }), { inputs: [heights, grid, outskirtsPart, landmarks, blocks, parkingPart, draftedPart], from: [...TREE_DATA, 'data/street-furniture.json', 'js/street-details.js', 'js/tree-placements.js', 'js/drafted-yards.js', 'js/trees.js', 'js/champion-trees.js'] });
  const streetDetails = details.made;
  markInit('streetDetails');
  await showLoadingStage('Creating traffic and pedestrian routes...');
  // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
  // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them.
  // Elevated building sections that clear even a bus don't obstruct ground traffic (Lamp: measured from the ground
  // under them, as colliders' heights are the world's since the city stands on terrain.js's heights).
  const traffic = await live.keep('traffic', () => cityPart(async (g) => createTrafficSystem(g, grid.made.sidewalks, [
    ...grid.made.footprints,
    ...details.made.footprints,
    ...parkingPart.made.footprints,
    bandShellPart.made.footprint,
    ...restroomsPart.made.footprints,
    // the cafes' tables and chairs out on the sidewalks, walked round (never in the way of the cars' lanes)
    ...(seatingPart.made.obstacles || []).map((o) => ({ minX: o.x - o.r, maxX: o.x + o.r, minZ: o.z - o.r, maxZ: o.z + o.r, pedestrianOnly: true })),
    ...allColliders.filter((c) => !c.obb
      && (c.minY ?? 0) - groundHeight((c.minX + c.maxX) * 0.5, (c.minZ + c.maxZ) * 0.5) < 3.5)
  ], details.made.signalIntersections, await closuresReady)), { inputs: [heights, grid, outskirtsPart, landmarks, blocks, details, seatingPart], from: [CITY_MAP, 'data/city-closures.json', 'js/pedestrian-system.js', 'js/road-network.js', 'js/curb-parking.js'] });
  const trafficSystem = traffic.made;
  markInit('traffic');
  // Lamp: the far fleet on the freeways (US-23, I-94, M-14), beyond the near traffic's reach round the player: thinner
  // and not as far out on the lighter tiers
  const highway = live.keep('highwayTraffic', () => cityPart((g) => createHighwayTraffic(g, freewayLanes(traffic.made.network), {
    hideNear: VEHICLE_RADIUS - 20,
    gapScale: TIER.name === 'full' ? 1 : TIER.name === 'light' ? 1.25 : TIER.name === 'slow' ? 2 : 3,
    farCull: 1600 * Math.max(0.5, TIER.farCut)
  })), { inputs: [grid, traffic], from: [CITY_MAP, 'js/road-network.js'] });
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
  }, { cull: setupSceneCulling, still: true }), { inputs: [heights, traffic], from: [CITY_MAP, 'js/road-network.js', 'js/road-paint.js', 'js/curb-parking.js'] });
  markInit('roadPaint');
  // the protected bike lanes' flex posts and curbs, the boardwalks and steps, and the BIKE ROUTE signs (bike-routes.js)
  const bikeRoutesPart = await live.keep('bikeRoutes', () => cityPart((g) => buildBikeRoutes(g, traffic.made.network), { cull: setupSceneCulling, still: true }), { inputs: [heights, traffic], from: [CITY_MAP, 'js/bike-routes.js'] });
  // Traffic lights and stop & yield signs where the road network put them (traffic-controls.js)
  const controlsPart = live.keep('trafficControls', () => cityPart((g) => buildTrafficControls(g, traffic.made.network), { cull: setupSceneCulling, still: true }), { inputs: [heights, traffic, details], from: ['js/traffic-controls.js'] });
  // Signs over the real shops, restaurants and cafes (shop-signs.js, from OpenStreetMap)
  const signsPart = live.keep('shopSigns', () => cityPart((g) => buildShopSigns(g), { cull: setupSceneCulling, still: true }), { inputs: [heights, blocks], from: ['js/shop-signs.js', 'js/shop-types.js', 'data/shop-types.json'] });
  await showLoadingStage('Laying the railroads...');
  // The tracks and the trains on them, stood on the ground where they're built (railways.js)
  // where streets cross the tracks at grade, with gates (build-rail-crossings.py, OpenStreetMap)
  const crossingBytes = await asset('data/rail-crossings.json');
  const railCrossings = crossingBytes ? JSON.parse(new TextDecoder().decode(crossingBytes)) : [];
  // Amtrak's Wolverine stops at Ann Arbor on its timetable (build-wolverine.py, from Amtrak's GTFS feed)
  const wolverineBytes = await asset('data/wolverine.json');
  const wolverine = wolverineBytes ? JSON.parse(new TextDecoder().decode(wolverineBytes)) : null;
  // its tracks and ties culled by distance like the rest of the town (their own cull distances), not drawn whole from
  // anywhere: on their own, as the trains move and the crossing arms are posed by their place in one mesh
  const cullRails = (g, roots, shadow) => {
    const rails = new THREE.Group();
    rails.name = 'Rails';
    for (const o of [...g.children]) if (o.name === 'RailTrack' || o.name === 'RailTies') rails.add(o);
    g.add(rails);
    return setupSceneCulling(g, [rails], shadow);
  };
  const railPart = live.keep('railways', () => cityPart((g) => buildRailways(g, railCrossings, wolverine), { cull: cullRails, still: true }), { inputs: [heights], from: ['data/rail-crossings.json', 'data/wolverine.json'] });
  const railways = railPart.made;
  // traffic and walkers stop at the crossings' gates while their lamps flash (traffic.js); handed over again on each
  // run of this file, as either part may have been made again by a change
  trafficSystem.setRailCrossings?.(railways.crossings || []);
  // Cars parked in the lots and along the main streets downtown, solid to the player (parked-cars.js)
  const parkedPart = live.keep('parkedCars', () => cityPart((g) => buildParkedCars(g, railways.nearTrack, [...parkingPart.made.stalls, ...pumpSpots(gasStations)])), { inputs: [heights, parkingPart], from: ['js/parked-cars.js', 'js/curb-parking.js', 'js/railways.js', 'js/gas-stations.js', 'data/curb-cuts.bin.gz'] });
  const parkedCars = parkedPart.made;
  // Kayaks pulled up on the river's banks at the parks, to get into there (kayak-launches.js)
  const launchesPart = live.keep('kayakLaunches', () => cityPart((g) => buildKayakLaunches(g)), { inputs: [heights], from: ['js/kayak-launches.js'] });
  const kayakLaunches = launchesPart.made;
  log(`[kayaks] ${kayakLaunches.count} on the banks`);
  // The Gallup Park canoe livery: its docks, racks, rental kayaks and pedal boats, and people out on its pond (gallup-livery.js)
  const liveryPart = live.keep('gallupLivery', () => cityPart((g) => buildLivery(g)), { inputs: [heights], from: ['js/gallup-livery.js', 'js/river-people.js'] });
  for (const c of parkedCars.colliders) allColliders.push(c);
  // The boxes that come and go as the city streams (parked cars, trees) and the cars the player leaves, patched into
  // each player's 48 m cells in place (controllers.js nearColliders): dropping the cells rebuilt them over every collider
  // in the city on the next step, 5-9 ms on a Mac and tens on the Xbox, every few seconds of driving downtown. A box
  // taken out swaps places with the last in the list (the cells keep each box's order in `_order`, not its place),
  // and leaves the cells around it too (a parked car shoved since it was put in them). A box may come back later
  // (a parked car drawn again), so it's left as it is.
  const colliderManagers = []; // the first player's, and the second's once split screen has started
  let colliderOrder = 1e9; // after every place in the list, which a full rebuild of the cells numbers from 0
  function addColliders(list) {
    for (const c of list) {
      if (allColliders[c._at] === c) continue; // (in already)
      c._at = allColliders.length;
      allColliders.push(c);
      c._order = colliderOrder++;
      for (const cm of colliderManagers) cm.refreshCollider(c);
    }
  }
  function removeColliders(gone) {
    const CELL = 48, cellKey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
    for (const c of gone) {
      if (!c) continue;
      const i = allColliders[c._at] === c ? c._at : allColliders.indexOf(c);
      if (i >= 0) {
        const last = allColliders.pop();
        if (last !== c) { allColliders[i] = last; last._at = i; }
      }
      for (const cm of colliderManagers) {
        const cells = cm._colliderCells;
        if (!cells) continue;
        for (let ix = Math.floor((c.minX - 16) / CELL); ix <= Math.floor((c.maxX + 16) / CELL); ix++) {
          for (let iz = Math.floor((c.minZ - 16) / CELL); iz <= Math.floor((c.maxZ + 16) / CELL); iz++) {
            const list = cells.get(cellKey(ix, iz));
            const j = list ? list.indexOf(c) : -1;
            if (j >= 0) { list[j] = list[list.length - 1]; list.pop(); }
          }
        }
      }
    }
  }
  // what moved in a way only its own code knows (a road work machine taken or left, everything put back by a reset):
  // every player's cells built again on their next step
  function dropColliderCells() {
    for (const cm of colliderManagers) cm._colliderCells = null;
  }
  // streamed, the parked cars near the camera come and go, and their boxes with them (parked-cars.js)
  parkedCars.onColliders = (added, removed) => {
    removeColliders(removed);
    addColliders(added);
  };
  // Road work: the blocks traffic.js closed, barricaded, coned and dug up (road-work.js); the machines are solid
  const roadWorkPart = live.keep('roadWork', () => cityPart((g) => buildRoadWork(g, traffic.made.closures)), { inputs: [heights, traffic], from: ['js/road-work.js'] });
  const roadWork = roadWorkPart.made;
  // Potholes from the City's 311 reports (potholes.js, build-potholes.py), felt as a jolt through the car
  const potholeBytes = await asset('data/potholes.json');
  const potholeData = potholeBytes ? JSON.parse(new TextDecoder().decode(potholeBytes)) : null;
  const potholesPart = live.keep('potholes', () => cityPart((g) => buildPotholes(g, potholeData), { cull: setupSceneCulling }), { inputs: [heights, grid], from: ['js/potholes.js', 'data/potholes.json'] });
  const potholes = potholesPart.made;
  log(`[potholes] ${potholes.count} on the streets`);
  // the speed humps and tables the city's Traffic Calming program built (speed-humps.js): a jolt, or a jump taken fast
  const humpBytes = await asset('data/speed-humps.json');
  const humpData = humpBytes ? JSON.parse(new TextDecoder().decode(humpBytes)) : null;
  const humpsPart = live.keep('speed-humps', () => cityPart((g) => buildSpeedHumps(g, humpData), { cull: setupSceneCulling }), { inputs: [heights, grid], from: ['js/speed-humps.js', 'data/speed-humps.json'] });
  log(`[humps] ${humpsPart.made.count} speed humps and tables`);
  // trash, recycling and compost carts out at the curb on today's pickup route (curb-carts.js): they fly when hit
  const cartBytes = await asset('data/collection-days.json');
  const cartData = cartBytes ? JSON.parse(new TextDecoder().decode(cartBytes)) : null;
  const cartsPart = live.keep('curb-carts', () => cityPart((g) => buildCurbCarts(g, cartData, addresses), { cull: setupSceneCulling }), { inputs: [heights, grid], from: ['js/curb-carts.js', 'data/collection-days.json', 'data/addresses.json'] });
  log(`[carts] ${cartsPart.made.count} carts${cartsPart.made.bags ? ` and ${cartsPart.made.bags} bags of leaves` : ''} out for ${cartsPart.made.day || 'no pickup today'}`);
  allColliders.push(...roadWork.colliders);
  allColliders.push(...airportPart.made.colliders);
  allColliders.push(...bleachersPart.made.colliders);
  // the diamonds' backstops, dugouts and fences (ball-diamonds.js)
  allColliders.push(...(diamondsPart.made.colliders || []));
  // the town's helipads, painted on the roofs (or ground) where the map has them (helipads.js)
  const helipadsPart = live.keep('helipads', () => cityPart((g) => buildHelipads(g, allColliders), { still: true }), { inputs: [heights, blocks, landmarks, parkingPart], from: ['js/helipads.js'] });
  // Tree trunks, lamp posts, signal poles and sign posts: thin and solid, so the car crashes into them and the bike
  // throws its rider (`thin`: the helicopter flies through them)
  // and each goes over when a car hits it hard enough (knockdowns.js)
  const obstacleBox = (o) => {
    const g = groundHeight(o.x, o.z);
    const knock = o.kind && !o.fixed && (o.pose || o.parts?.length) ? { ...o, g, down: false } : null;
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
  seatingPart.made.bindColliders?.((o) => knockBoxOf.get(o)); // put away out of season and overnight (street-life.js)
  setSitSpots(seatSpots); // the town's people sit at them too (pedestrian-system.js)
  // streamed, the trees near the camera come and go, and their trunks with them (trees.js)
  const treeField = details.made.treeField;
  if (TIER.stream && treeField?.obstacles) {
    const boxOf = new Map();
    const boxes = (list) => list.map((o) => { const b = obstacleBox(o); boxOf.set(o, b); return b; });
    for (const b of boxes(treeField.obstacles())) allColliders.push(b);
    treeField.onObstacles = (added, removed) => {
      if (removed.length) {
        const gone = [];
        for (const o of removed) { gone.push(boxOf.get(o)); boxOf.delete(o); }
        removeColliders(gone);
      }
      addColliders(boxes(added));
    };
  }
  // where the sun's shadows aren't drawn (an Xbox, split screen), soft shade on the ground under what stands there
  // and along the foot of the buildings (ground-shade.js)
  // (it looks round the view from the first player's collision cells, made below, rather than through every box in town)
  const groundShade = createGroundShade(new THREE.Group(), { colliders: allColliders, peds: trafficSystem.peds,
    near: (x, z, r) => controllerManager.nearColliders(x, z, r) });
  scene.add(groundShade.group);
  // the carts at the curb: knocked flying by the car (knockdowns.js), never shaded on the ground as the buildings are
  for (const o of cartsPart.made.obstacles || []) allColliders.push(obstacleBox(o));
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
      { x: it.x + it.dx * it.height * 0.6, y: it.g, z: it.z + it.dz * it.height * 0.6 }, Math.min(1, 0.4 + spin * 0.2)),
    // a cart come to rest is solid where it lies: put its box in the collision cells there (controllers.js)
    onRest: (it, c) => {
      for (const cm of colliderManagers) cm.refreshCollider(c);
    }
  });
  // Lamp: Ann Arbor's animals, near the player only; never anyone's obstacle (animals.js)
  // (none on the Xbox, where they're never shown: an empty part, so their models and shaders aren't made there at all)
  const animalsPart = live.keep('animals', () => cityPart((g) => (XBOX ? { update() {} } : buildAnimals(g))), { inputs: [heights, details], from: ['js/animals.js', 'js/animal-models.js', 'js/animal-birds.js', 'js/river-birds.js', 'js/city-birds.js', 'js/deer.js'] });
  // the rooms behind the shopfronts' glass, near the player: furniture and people (shop-interiors.js)
  const shopRoomsPart = live.keep('shopRooms', () => cityPart((g) => createShopInteriors(g)), { inputs: [blocks], from: ['js/shop-interiors.js', 'js/shop-kits.js', 'js/shop-kits-b.js', 'js/shop-kits-c.js', 'js/shop-kit-core.js', 'js/shop-types.js'] });
  const parts = [shopRoomsPart, grid, bandShellPart, restroomsPart, draftedPart, cascadesPart, riverPeoplePart, animalsPart, outskirtsPart, landmarks, blocks, details, traffic, highway, roadPaint, controlsPart, signsPart, railPart, parkedPart, launchesPart, liveryPart, roadWorkPart, potholesPart, humpsPart, cartsPart, planesPart, scootersPart, racksPart, poolsPart, seatingPart, diamondsPart, footballPart, bleachersPart, docksPart, skatePart, mtbPart, b2bPart, bikeRoutesPart, parkingPart, airportPart, moonPart, starsPart, helipadsPart];
  for (const part of parts) {
    scene.add(part.group);
    cullAlso(part.culled);
  }
  // On an Xbox the shadow passes draw the city's casters again for each cascade, on a CPU that pays far more for each
  // draw: only what's a person's height or more casts (houses, trees, cars, walls), not the bike racks, posts and signs
  if (XBOX && QUALITY.shadows) {
    let small = 0;
    for (const part of parts) part.group.traverse((o) => {
      if (!o.isMesh || !o.castShadow || o.userData.shadowProxy || !o.geometry) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if ((o.geometry.boundingSphere?.radius ?? Infinity) < 0.9) { o.castShadow = false; small++; }
    });
    log(`[xbox] ${small} small kinds of thing no longer cast shadows`);
  }
  // What a part hooks on its scene's renders is on its group, which three.js never calls (the trees follow the view
  // camera for their level of detail, trees.js): the scene calls it for each part.
  // the houses near the player, on a phone (houses.js streamHouses)
  const houseStream = blocks.group.getObjectByName('AnnArborHouses')?.userData.stream;
  // Lamp: snow lies where it really lies today (snow-cover.js), on what stands still: moving traffic, people, the
  // river and the sky stay as they are
  // (only once there is snow: on a bare day the materials keep their shaders as they are)
  // (a pool's coping, deck and chairs too, but not what's under its water or floats on it: the water's left open, as
  // nothing says which pools are covered)
  // (asked again when Ann Arbor's date turns over while it's played: watchDate below; a material's dressed once)
  const coverWithSnow = () => loadSnowCover().then((cover) => {
    if (cover <= 0) return;
    poolsPart.group.traverse((o) => { if (o.isMesh && /^(Pool floor|Pool walls|Lane ropes)/.test(o.name)) for (const m of [o.material].flat()) m.userData.snow = 0; });
    for (const part of [grid, bandShellPart, restroomsPart, outskirtsPart, landmarks, blocks, details, controlsPart, signsPart, railPart, parkedPart, roadWorkPart, scootersPart, racksPart, seatingPart, poolsPart, diamondsPart, footballPart, bleachersPart, docksPart, skatePart, mtbPart, b2bPart, parkingPart, airportPart]) dressForSnow(part.group);
  });
  coverWithSnow();
  // Ann Arbor's date, checked about once a minute by the clock and as the page is shown again (a session left running
  // past midnight, or a Mac woken the next day): when it turns over, the moon takes tonight's phase and the snow
  // today's depth in place. The day's curb carts and road closures are built into the city (its traffic routes round
  // the closures), so when they'd be different now a notice says a reload brings today's.
  const annArborDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
  const dateWatch = { day: annArborDate(), checkedAt: performance.now(), toldStale: false };
  const closureKey = (list) => (list || []).map((c) => `${c.street}|${c.project}|${c.dates}|${c.point || ''}`).sort().join(';');
  const builtClosures = closuresReady.then(closureKey);
  function watchDate(force = false) {
    const now = performance.now();
    if (!force && now - dateWatch.checkedAt < 60e3) return;
    dateWatch.checkedAt = now;
    const day = annArborDate();
    if (day === dateWatch.day) return;
    log(`[date] ${dateWatch.day} → ${day} in Ann Arbor: the moon, the snow and the day's carts and closures looked at again`);
    dateWatch.day = day;
    moonPart.made.setPhase?.();
    poolsPart.made.setSeason?.(day);
    refreshSeason(); // the trees' leaves and the lawns (seasons.js)
    coverWithSnow().catch(() => {});
    const cartsStale = (cartsPart.made.day || null) !== cartDay(cartData);
    Promise.all([builtClosures, loadCityClosures().catch(() => null)]).then(([was, list]) => {
      const closuresStale = list != null && closureKey(list) !== was;
      if (!(cartsStale || closuresStale) || dateWatch.toldStale) return;
      dateWatch.toldStale = true;
      const what = cartsStale && closuresStale ? 'carts and road closures' : cartsStale ? 'curb carts' : 'road closures';
      // (only logged: the player isn't told; the next time the game opens has them)
      log(`[date] today's ${what} differ from the ones built: a reload brings them`);
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) watchDate(true); });
  const partHooks = parts.map((part) => part.group).filter((g) => g.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender);
  scene.onBeforeRender = (...args) => { for (const g of partHooks) g.onBeforeRender(...args); };
  markInit('ground');

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter) & Multi-Camera System
  await showLoadingStage('Preparing player, vehicles and controls...');
  // each box's place in the list, so one let go is found without a search (removeColliders)
  allColliders.forEach((c, i) => { c._at = i; });
  const controllerManager = new ThirdPersonControllerManager(scene, allColliders);
  colliderManagers.push(controllerManager);
  controllerManager.knockdowns = knockdowns;
  controllerManager.parkedCars = parkedCars;
  controllerManager.kayakLaunches = kayakLaunches;
  controllerManager.livery = liveryPart.made;
  controllerManager.riverPeople = riverPeoplePart.made;
  controllerManager.docks = docksPart.made;
  controllerManager.seats = seatSpots;
  controllerManager.skatePark = skatePart.made;
  controllerManager.bleachers = bleachersPart.made;
  controllerManager.mtbTrails = mtbPart.made;
  controllerManager.bikeRoutes = bikeRoutesPart.made;
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
  // and their swings, sat on and pumped (playgrounds.js swings, controllers.js boardSwing)
  controllerManager.swings = cityGrid.swings || null;
  controllerManager.potholes = potholes;
  controllerManager.speedHumps = humpsPart.made;
  controllerManager.railways = railways;
  // the maize sports car, or the black Forester it was before (an older save's own car)
  const isOwnLook = (look) => (look.kind === 'sports' && look.hex === 0xffcb05) || (look.kind === 'forester' && look.hex === 0x16181b);
  // The cars taken from parking spots and left in them in earlier plays (a part kept over a change has them still)
  // (a save that can't be played again, from a version that kept them otherwise, is forgotten rather than stopping the start)
  if (!parkedCars.history.length) {
    try {
      addColliders(parkedCars.replay(load('parkedSwaps')));
    } catch (error) {
      log(`[parked] the cars swapped in an earlier play couldn't be put back: ${error?.message || error}`);
      parkedCars.history.length = 0;
      parkedCars.reset?.();
      save('parkedSwaps', []);
    }
  }
  // Where each way of getting around starts, a view of the city at each (heading 0 faces south, PI north)
  const SCENIC_STARTS = {
    // on the Diag, looking up Ingalls Mall to Burton Tower and Hill Auditorium
    person: { x: 845, z: 242, heading: Math.atan2(797 - 845, 23 - 242) },
    // Main St at William, in the northbound lane, looking up downtown's shopfronts
    car: { x: -23, z: 228, heading: Math.atan2(14.8, -378) },
    // on the Border to Border Trail in Gallup Park, the Huron on the right and the trail's sign ahead (b2b-route.js),
    // 15 m back along it from the Teleport menu's "Border to Border Trail" arrival (on that very spot, the bike left
    // there pushed the next arrival off the path, onto the bench beside it)
    cyclist: { x: 3912.1, z: 520.3, heading: TELEPORT_LOCATIONS.b2b.heading },
    // in a helicopter on the airport's apron, in the row by the FBO (airport.js; `atAirport` takes the middle one)
    helicopter: { x: 130, z: 6075, heading: 0.15, atAirport: 1, face: { x: -29, z: 1529 } },
    // in the Argo Cascades' channel just above its first drop, facing down it (cascades.js)
    kayak: { ...CASCADE_START }
  };

  // Fly's start: the player's flying machine is that parked helicopter (its spot stands empty while it's theirs, and a
  // plane taken before goes back to its own spot), at rest on the apron
  // (at rest on the apron's pavement, laid over the lawn there: airport.js PAVE, as controllers.js helicopterFloor has it)
  const restingHeight = (x, z) => groundHeight(x, z) + (onAirfield(x, z) ? PAVE : 0) + 0.25;
  function startInHelicopter(s) {
    const h = controllerManager.entities.helicopter;
    const at = airportPart.made.take(s.atAirport);
    airportPart.made.dress(h, 'helicopter');
    controllerManager.teleportActiveTo(at.x, at.z, s.face ? Math.atan2(s.face.x - at.x, s.face.z - at.z) : at.heading, restingHeight(at.x, at.z));
    h.position.set(at.x, restingHeight(at.x, at.z), at.z);
    // turned to face the Big House, far off up State St
    h.heading = s.face ? Math.atan2(s.face.x - at.x, s.face.z - at.z) : at.heading;
    h.speed = h.verticalSpeed = h.pitchAngle = h.rollAngle = 0;
    h.mesh.position.copy(h.position);
    h.mesh.rotation.y = h.heading;
    log('[airport] Fly starts in the parked helicopter by the FBO');
  }
  // Reuse teleport placement so saved players return at rest, close to their last positions.
  // A kept place is where it was left: the others there (the person beside their car, or in it) don't push it aside
  // as they would a teleport's arrival (they're set out of the way, far below, while it's placed)
  function restorePlace(mode, p) {
    const cm = controllerManager;
    const others = Object.values(cm.entities).filter((e) => e !== cm.entities[mode]);
    const ys = others.map((e) => e.position.y);
    for (const e of others) e.position.y = -1e6;
    cm.setMode(mode);
    cm.teleportActiveTo(p.x, p.z, p.heading, p.y);
    others.forEach((e, i) => { e.position.y = ys[i]; });
  }
  try {
    // Kept with Lamp's save(), which the preview keeps to one play, so every preview starts in the same place.
    const saved = load('player');
    if (saved?.version !== 2) {
      // a first play: each of them waiting at its own start, the player in the car on Main St
      for (const [mode, s] of Object.entries(SCENIC_STARTS)) {
        if (!controllerManager.entities[mode]) continue;
        controllerManager.setMode(mode);
        if (s.atAirport != null) startInHelicopter(s); else controllerManager.teleportActiveTo(s.x, s.z, s.heading, s.above ? groundHeight(s.x, s.z) + s.above : null);
        // the kayak faces the cascades' channel, not the way the pond's water would turn it
        if (mode === 'kayak') { const k = controllerManager.entities.kayak; k.heading = s.heading; k.mesh.rotation.y = s.heading; }
      }
      controllerManager.setMode('car');
    }
    if (saved?.version === 2) {
      for (const mode of Object.keys(controllerManager.entities)) {
        const p = saved.entities?.[mode];
        if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
        restorePlace(mode, p);
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
      if (saved.launchesTaken >= 0) kayakLaunches.take(saved.launchesTaken);
    }
  } catch { /* Missing or unavailable storage does not prevent playing. */ }

  function savePlayerState() {
    try {
      // one sitting down is kept where they stood to sit
      const entities = Object.fromEntries(Object.entries(controllerManager.entities).map(([mode, entity]) => [mode, entity.sitting || entity.swing ? {
        ...(entity.sitting || entity.swing).from, heading: entity.heading
      } : {
        x: entity.position.x, y: entity.position.y, z: entity.position.z, heading: entity.heading
      }]));
      const leftEmpty = Object.keys(controllerManager.entities).filter((mode) => controllerManager.entities[mode].leftEmpty);
      save('player', { version: 2, activeMode: controllerManager.activeMode, entities, carLook: controllerManager.carLook, leftEmpty,
        boat: controllerManager.entities.kayak.boat, liveryTaken: liveryPart.made.taken, docksTaken: docksPart.made.taken,
        launchesTaken: kayakLaunches.taken });
      save('parkedSwaps', parkedCars.history);
    } catch { /* Storage may be disabled or full. */ }
  }

  const keptCamera = live.keep('camera', () => CameraSystem.makeCamera());
  // a camera that once followed a broken position keeps it: start it again rather than draw nothing
  if (![keptCamera.position.x, keptCamera.position.y, keptCamera.position.z, keptCamera.quaternion.w].every(Number.isFinite)) {
    keptCamera.position.set(0, 50, 100); keptCamera.quaternion.identity(); keptCamera.updateMatrixWorld(true);
  }
  // a camera kept from an earlier run takes this tier's reach (the Xbox's is shorter: device-tier.js)
  if (keptCamera.far !== (TIER.far || 60000)) { keptCamera.far = TIER.far || 60000; keptCamera.updateProjectionMatrix(); }
  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager, keptCamera);
  // golf on the courses: from a tee on foot, Play golf (golf-play.js)
  const golf = new GolfPlay({ scene, cm: controllerManager, cameraSystem, notice: (t, secs) => showNotice(t, secs),
    soundOn: () => audioSystem.enabled, onChange: () => { getInWords = getInNow(); renderControlHints(controllerManager.activeMode); touchControls.setGetOutWords(getInWords || 'Get in'); } });
  // the window's shape (stage.js): the camera as wide as the drawing, set again on each resize
  let stage = stageSize();
  cameraSystem.onResize(stage.w, stage.h, FILLS);
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
  // a parked bike the player runs into: a clatter as it goes, a thud where it lands (bike-racks.js)
  const rackCue = (kind, at, k) => audioSystem.cue(kind, at, k);
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
  // storms, the live wind, fireflies and the sounds of outdoors (outdoors.js)
  const outdoors = createOutdoors({ scene, lightingSystem, audioSystem, controllerManager, hydrantSpray });

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
  // over a speed hump: a bump under the car, harder when it takes off
  controllerManager.onHump = (x, z, strength) => {
    _holeAt.x = x; _holeAt.z = z; _holeAt.y = groundHeight(x, z) + 0.3;
    audioSystem.cue('thud', _holeAt, Math.min(1, 0.2 + strength * 0.6));
  };
  // the safety corridor cruiser's one line ('Warning: 47 in a 35'), where the place label sits
  trafficSystem.setNotice?.((text, secs) => showNotice(text, secs));
  // a big car jump's numbers as it lands, under the cinematic view (cameras.js updateJumpCam)
  cameraSystem.onJumpStats = ({ air, distanceFt, heightFt }) =>
    showNotice(`${air.toFixed(1)} s airtime · ${Math.round(distanceFt)} ft · ${Math.round(heightFt)} ft high`, 3.5);
  // someone knocked down by the player's car or bike: a thump there and a jolt in the hands
  const _thudAt = { x: 0, y: 0, z: 0 };
  // (who: 0 the first player, 1 the second in split screen)
  trafficSystem.setPedestrianHitListener?.((x, z, speed, who = 0) => {
    _thudAt.x = x; _thudAt.z = z; _thudAt.y = groundHeight(x, z) + 0.6;
    audioSystem.cue('thud', _thudAt, Math.min(1, 0.4 + speed / 20));
    rumble(who, Math.min(1, 0.3 + speed / 25), Math.min(1, 0.2 + speed / 30), 0.25);
    log(`Knocked someone down at ${speed.toFixed(1)} m/s`);
  });
  // the player hit by a car, on foot or on the bike
  // a cyclist on the Border to Border Trail ringing to pass (traffic.js, b2b-riders.js)
  trafficSystem.setTrailBellListener?.((at) => audioSystem?.trailBell(at));
  trafficSystem.setPlayerStruckListener?.((vx, vz, speed, type, who = 0) => {
    const cm = who && split.second ? split.second.cm : controllerManager;
    const at = cm.getActiveEntity().position;
    audioSystem.cue('thud', at, Math.min(1, 0.5 + speed / 20));
    rumble(who, Math.min(1, 0.5 + speed / 20), Math.min(1, 0.4 + speed / 25), 0.35);
    if (type === 'cyclist') cm.throwRider(speed, vx, vz);
    else if (type === 'motorbike') cm.throwMotoRider(speed, vx * 0.6, vz * 0.6);
    else cm.knockDown(vx * 1.1, 1.5 + speed * 0.2, vz * 1.1, 0, 0.6);
    log(`${who ? 'Player 2 hit' : 'Hit'} by a car at ${speed.toFixed(1)} m/s`);
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
  let renderPipeline, scenePass, colorGrade, ssrPass = null, sceneMRT = null, aoPass = null;
  if (!QUALITY.reflections) {
    scenePass = pass(scene, cameraSystem.camera);
    scenePass.renderTarget.storeMultisampledColorBuffer = false;
    scenePass.renderTarget.storeMultisampledDepthBuffer = false;
    // Ambient occlusion (device-tier.js `ao`: full and light): ground-truth AO at half size from the scene's depth alone
    // (its normals worked out from the depth, so no second target), 8 samples within 2 m: cars, people, benches and
    // bins sit on the ground and the joins of walls, porches and kerbs darken. Its radius is in metres, so far off it
    // shrinks under a pixel and fades by itself
    scenePass.renderTarget.resolveDepthBuffer = QUALITY.ao;
    if (QUALITY.ao) {
      aoPass = ao(scenePass.getTextureNode('depth'), null, cameraSystem.camera);
      aoPass.resolutionScale = 0.5;
      aoPass.samples.value = 8;
      aoPass.radius.value = 2.0;
      aoPass.scale.value = 2.5;
    }
    colorGrade = createPostProcessing(renderer, scenePass.getTextureNode('output'), vec3(0), { bloom: QUALITY.bloom, ao: aoPass });
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
  // (once the eye's button works: run once below, where it's wired up, and again whenever a touch screen turns up)
  const cleanViewOnTouch = () => {
    if (touchControls.available && !hudChosen && hudToggleBtn && !document.body.classList.contains('hud-minimized')) hudToggleBtn.click();
  };
  touchControls.onAvailabilityChange = () => {
    placeModeIndicator();
    cleanViewOnTouch();
  };
  touchControls.onGetInOut = () => getInOrOut();
  // the touch horn (shown while driving a car), as B on the keyboard
  touchControls.onHorn = () => { if (!mapSystem.isFullMapOpen) audioSystem.honk(controllerManager.getActiveEntity()); };
  // and the siren's (shown in a cruiser or the ambulance), as L
  touchControls.onSiren = () => { if (!mapSystem.isFullMapOpen) toggleSiren(); };

  // the frame rate, between the name and the GitHub link (made here too, for a page opened before it was in index.html)
  if (!document.getElementById('hud-fps')) {
    const fps = document.createElement('span');
    fps.className = 'brand-fps';
    fps.setAttribute('aria-label', 'Frames a second');
    fps.innerHTML = '<span id="hud-fps">--</span> fps';
    document.querySelector('.brand-heading .repo-link')?.before(fps);
  }
  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elLimit = document.getElementById('hud-limit'), elLimitMph = document.getElementById('hud-limit-mph');
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
    onMapInput: (input, dt) => mapSystem.gamepad(input, dt),
    onRadio: (dir) => carRadio.tune(dir),
    // B, as B on the keyboard (not over the map): the horn, or the bicycle's bell
    onHorn: () => { if (!mapSystem.isFullMapOpen) audioSystem.honk(controllerManager.getActiveEntity()); },
    // the pad's up, as L: a cruiser's or the ambulance's lights and siren
    onSiren: () => { if (!mapSystem.isFullMapOpen) toggleSiren(); }
  });
  const carRadio = new CarRadio();
  // split screen's state (see showSplit), here before anything that reads it
  const split = { on: false, second: null, view: null, offered: false, kept: null, drawn: false };
  const swingFoci = [null, null];
  // a swing's chain creaking on its hook at the end of its arc (audio-events.js creak)
  const swingCreak = (at, loud) => audioSystem?.cue('creak', at, loud);
  // each camera as wide as what it draws into: the whole drawing, or a half of it side by side
  function fitCameras() {
    const two = split.drawn;
    cameraSystem.onResize(two ? stage.w / 2 : stage.w, stage.h, FILLS && !two);
    split.second?.cs.onResize(stage.w / 2, stage.h);
  }

  // The guide to each mode's controls, written once: the keys the city reads (by their codes, as controllers.js and the
  // keydown handler below have them) and the controller's buttons, sticks and triggers (as gamepad-controls.js reads
  // Lamp's pad). It shows the half for what the player is holding, named and drawn by Lamp's runtime.
  const orbit = { keys: ['Drag'], pad: [STICK.RIGHT], does: 'Orbit' };
  const controlHints = {
    person: [{ keys: ['KeyW', 'KeyS'], does: 'Walk' }, { keys: ['KeyA', 'KeyD'], does: 'Turn' },
      { pad: [STICK.LEFT], does: 'Walk' }, { keys: ['Space'], pad: [BUTTON.A], does: 'Jump' }, orbit, { keys: ['KeyR'], pad: [BUTTON.RIGHT], does: 'Music' }],
    car: [{ keys: ['KeyW', 'KeyS'], pad: [TRIGGER.RT, TRIGGER.LT], does: 'Drive' },
      { keys: ['KeyA', 'KeyD'], pad: [STICK.LEFT], does: 'Steer' }, { keys: ['Space'], pad: [BUTTON.A], does: 'Handbrake' },
      { keys: ['KeyB'], pad: [BUTTON.B], does: 'Horn' }, { keys: ['KeyL'], pad: [BUTTON.UP], does: 'Siren', siren: true },
      { keys: ['KeyR'], pad: [BUTTON.RIGHT], does: 'Radio' }, { pad: [STICK.RIGHT], does: 'Orbit' },
      { keys: ['KeyX'], pad: [BUTTON.LSTICK], does: 'Look back' }],
    cyclist: [{ keys: ['KeyW', 'KeyS'], pad: [TRIGGER.RT, TRIGGER.LT], does: 'Pedal' },
      { keys: ['KeyA', 'KeyD'], pad: [STICK.LEFT], does: 'Steer' }, { keys: ['Space'], pad: [BUTTON.A], does: 'Brake' },
      { keys: ['KeyB'], pad: [BUTTON.B], does: 'Bell' }, orbit, { keys: ['KeyR'], pad: [BUTTON.RIGHT], does: 'Music' },
      { keys: ['KeyX'], pad: [BUTTON.LSTICK], does: 'Look back' }],
    helicopter: [{ keys: ['KeyW', 'KeyS'], does: 'Pitch' }, { keys: ['KeyA', 'KeyD'], does: 'Yaw' },
      { pad: [STICK.LEFT], does: 'Fly' }, { keys: ['Space', 'KeyE'], pad: [TRIGGER.RT], does: 'Ascend' },
      { keys: ['KeyQ', 'KeyC'], pad: [TRIGGER.LT], does: 'Descend' }],
    plane: [{ keys: ['KeyW', 'KeyS'], does: 'Throttle' }, { keys: ['KeyA', 'KeyD'], does: 'Turn' },
      { pad: [STICK.LEFT], does: 'Fly' }, { keys: ['Space', 'KeyE'], pad: [TRIGGER.RT], does: 'Pull up' },
      { keys: ['KeyQ', 'KeyC'], pad: [TRIGGER.LT], does: 'Nose down' }],
    kayak: [{ keys: ['KeyW', 'KeyS'], does: 'Paddle' }, { keys: ['KeyA', 'KeyD'], does: 'Turn' },
      { pad: [STICK.LEFT], does: 'Paddle' }, orbit, { keys: ['KeyR'], pad: [BUTTON.RIGHT], does: 'Music' }]
  };
  // Getting in and out, in every mode
  for (const [mode, hints] of Object.entries(controlHints)) {
    hints.push({ keys: ['KeyF'], pad: [BUTTON.X], does: mode === 'person' ? '' : 'Get out', getOut: mode !== 'person', getIn: mode === 'person' });
    // View: into the toolbar (gamepad-controls.js)
    hints.push({ pad: [BUTTON.VIEW], does: 'Toolbar' });
  }
  // Lined up over a golf ball (golf-play.js): the stick or the turn keys aim, forward and back change the club, and
  // swing is held to fill the meter and let go to hit
  controlHints.golf = [{ keys: ['KeyA', 'KeyD'], pad: [STICK.LEFT], does: 'Aim' }, { keys: ['Space'], pad: [BUTTON.A], does: 'Swing' }, { keys: ['KeyF'], pad: [BUTTON.X], does: 'Stop golfing' }];
  // On a playground swing: forward and back pump it, F jumps off
  controlHints.swing = [{ keys: ['KeyW', 'KeyS'], pad: [STICK.LEFT], does: 'Pump' }, { keys: ['KeyF'], pad: [BUTTON.X], does: 'Jump off' }];
  // Getting out of a car on the move or the helicopter in the air is a jump, and its hint says so
  let jumpOut = false;
  // On foot, what F would do now (what's in reach, looked for each quarter second below): '' with nothing near hides it
  let getInWords = '';
  // the tee a round starts from with F, or -1: not while a car, bike or boat is in reach to get into (a car left by the
  // tee is got back into, not a round started)
  function teeToPlay(p) {
    const tee = golf.teeNear(p.position.x, p.position.z);
    if (tee < 0) return -1;
    const c = controllerManager.enterOrExit(parkedCars, trafficSystem, true);
    return c && !c.sit ? -1 : tee;
  }
  function getInNow() {
    const cm = controllerManager, p = cm.entities.person;
    if (cm.activeMode !== 'person' || p.fallen || p.chute) return '';
    if (p.onBus) return 'Get off';
    if (golf.active) return 'Stop golfing';
    if (p.swing) return 'Jump off';
    if (!p.sitting && teeToPlay(p) >= 0) return 'Play golf';
    if (trafficSystem.boardBus(p.position.x, p.position.z, 5, true)) return 'Board the bus';
    const c = cm.enterOrExit(parkedCars, trafficSystem, true);
    if (!c) return '';
    if (c.sit) return 'Sit';
    if (c.swing) return 'Swing';
    if (c.rack || c.mode === 'cyclist') return 'Ride';
    return 'Get in';
  }
  // Lamp: a police cruiser's or the ambulance's lights and siren (controllers.js setSiren), L, the pad's up or the
  // touch siren button: on and off while the player drives one, off as they get out or take another (syncSiren, each
  // frame), never saved. Traffic ahead pulls over for it and the police leave a speeding siren be (traffic.js)
  const sirenCan = () => {
    const cm = controllerManager;
    return cm.activeMode === 'car' && !!cm.entities.car.sirenKind && !cm.entities.person.onBus;
  };
  let sirenShown = null;
  function toggleSiren() {
    if (!sirenCan()) return;
    const car = controllerManager.entities.car;
    const on = controllerManager.setSiren(!car.siren);
    log(`[siren] ${car.sirenKind === 'ambulance' ? 'the ambulance' : 'the cruiser'}'s lights and siren ${on ? 'on' : 'off'}`);
    syncSiren();
  }
  function syncSiren() {
    const car = controllerManager.entities.car, can = sirenCan();
    if (car.siren && !can) { controllerManager.setSiren(false); log('[siren] off: out of the car'); }
    if (sirenShown && sirenShown.can === can && sirenShown.on === car.siren) return;
    const canChanged = sirenShown?.can !== can;
    sirenShown = { can, on: car.siren };
    touchControls.setSiren(can, car.siren);
    // (the hint bar shows L Siren only in such a car)
    if (canChanged) renderControlHints(controllerManager.activeMode);
  }

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
    if (mode === 'person' && golf.active) mode = 'golf';
    if (mode === 'person' && controllerManager.entities.person.swing) mode = 'swing';
    const pad = on.kind === 'controller';
    const items = (controlHints[mode] || []).filter((hint) => (pad ? hint.pad : hint.keys) && !(hint.getIn && !getInWords) && !(hint.siren && !sirenCan())).map((hint) => {
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
      words.textContent = hint.getIn ? getInWords : hint.getOut && jumpOut ? 'Jump out' : hint.does;
      item.appendChild(words);
      return item;
    });
    elControlsHint.replaceChildren(...items);
    fitHints();
  }
  // the key hints stay on one row: hidden where that row would reach the place signs and map or the speed panel
  function fitHints() {
    if (!elControlsHint) return;
    elControlsHint.classList.remove('hints-off');
    const r = elControlsHint.getBoundingClientRect();
    if (!r.width) return;
    const hits = (sel) => {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      return b && b.width > 0 && b.right > r.left - 12 && b.left < r.right + 12 && b.bottom > r.top && b.top < r.bottom;
    };
    elControlsHint.classList.toggle('hints-off', hits('.hud-bottom-left') || hits('.hud-bottom-right') || r.left < 0 || r.right > window.innerWidth);
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
    // (a landmark's flyover doesn't follow the player into another vehicle)
    endChampionFlyover();
    selectingMode = true;
    try { controllerManager.setMode(mode); } finally { selectingMode = false; }
    showMode(mode);

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }
  // the page's half of a change of mode (buttons, hints, touch and pad controls), also for the changes the controller
  // makes on its own: thrown off a bike, knocked off by a car (controllers.js setMode)
  let selectingMode = false;
  controllerManager.onModeChange = (mode) => { if (!selectingMode) showMode(mode); };
  function showMode(mode) {
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
  }

  // 1 to 5 (the mode buttons, the bumpers): another way of getting around starts at its own view of the city, unless
  // it's already close by (the car the player just stepped out of), when the player simply takes it
  function travelBy(mode) {
    const cm = controllerManager;
    if (mode === 'car' && cm.entities.car.machine === 'stairtruck' && !airportPart.made.stairsHeld) retakeStairs();
    if (mode === cm.activeMode || !cm.entities[mode]) { selectMode(mode); return; }
    // out of a car on the move or the helicopter in the air: on foot as F does it (thrown out, or a jump); into
    // something else, what was left goes on without them rather than stopping dead where it was
    const was = cm.activeMode, left = cm.getActiveEntity();
    const jump = was !== 'person' ? cm.exitJump() : null;
    if (jump && mode === 'person') { getInOrOut(); return; }
    const here = left.position, there = cm.entities[mode].position;
    const close = Math.hypot(there.x - here.x, there.z - here.z) < 40;
    selectMode(mode);
    if (jump) { left.leftEmpty = true; left.coasting = true; }
    if (!close) { goToStart(mode); return; }
    // taken close by, as F takes it: the person rides in it, and what they were in stands empty
    if (mode !== 'person') {
      cm.entities.person.riding = mode;
      cm.entities[mode].leftEmpty = false;
      if (was !== 'person') left.leftEmpty = true;
    }
  }
  // Reset game: every way of getting around back at its own start, the player in their own car on Main St, the time
  // back to now and what earlier plays left behind (parked cars swapped) forgotten
  function resetGame() {
    const cm = controllerManager;
    const p = cm.entities.person;
    p.fallen = null;
    // (and the computer judged afresh: see watchWork)
    save('slowWork', null);
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
    kayakLaunches.release();
    dropColliderCells();
    for (const [mode, s] of Object.entries(SCENIC_STARTS)) {
      const e = cm.entities[mode];
      if (!e) continue;
      // (setMode leaves the one before it standing empty, as it should be once the player is back in their car)
      cm.setMode(mode);
      if (s.atAirport != null) startInHelicopter(s); else cm.teleportActiveTo(s.x, s.z, s.heading, s.above ? groundHeight(s.x, s.z) + s.above : null);
      if (mode === 'kayak') { e.heading = s.heading; e.mesh.rotation.y = s.heading; }
      if (mode === 'car') cm.stopCar(e);
    }
    p.riding = 'car';
    selectMode('car');
    parkedCars.history.length = 0;
    // the parked cars taken and left in this play put back as they were (parked-cars.js), their boxes with them
    // (onColliders above)
    parkedCars.reset?.();
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

  // Quality (the toolbar's gauge): Automatic (device-tier.js's own choice, by this computer and how its frames ran),
  // Full or Lighter, kept in this browser and read as the city's built, so a change reloads the page. Not on a phone
  // or the Xbox, whose city is what they can hold.
  const qualityBtn = document.getElementById('btn-quality');
  const QUALITY_WORDS = { auto: 'Automatic', full: 'Full', lighter: 'Lighter' };
  if (qualityBtn && QUALITY_CHOOSABLE) {
    qualityBtn.hidden = false;
    const chosen = qualityChoice();
    qualityBtn.title = `Quality: ${QUALITY_WORDS[chosen]}`;
    const auto = document.querySelector('#quality-popover [data-quality="auto"] .pop-sub');
    if (auto && chosen === 'auto') auto.textContent = `Chosen for this computer: ${{ full: 'the full city', light: 'the full look, a nearer city', slow: 'the lighter city' }[TIER.name] || TIER.name} now`;
    document.querySelectorAll('#quality-popover [data-quality]').forEach((btn) => {
      const v = btn.dataset.quality;
      btn.classList.toggle('active', v === chosen);
      btn.setAttribute('aria-pressed', String(v === chosen));
      btn.addEventListener('click', () => {
        closePopovers();
        if (v === qualityChoice()) return;
        if (!setQualityChoice(v)) { showNotice('The quality could not be saved in this browser', 3); return; }
        log(`[tier] quality set to ${v}: reloading`);
        showNotice(`Quality: ${QUALITY_WORDS[v]}. Reloading to apply it…`, 3);
        savePlayerState();
        setTimeout(() => location.reload(), 1200);
      });
    });
  }

  function goToStart(mode) {
    const s = SCENIC_STARTS[mode];
    if (!s) return;
    endChampionFlyover();
    if (s.atAirport != null) startInHelicopter(s); else controllerManager.teleportActiveTo(s.x, s.z, s.heading, s.above ? groundHeight(s.x, s.z) + s.above : null);
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
  let lastUnder = '0';
  // the camera under the river's surface (the river's level runs on over the land beside it, so only where the river
  // really is: not in the stadium's bowl)
  const underAt = (cp) => {
    const level = waterLevel(cp.x, cp.z);
    return level != null && riverDepth(cp.x, cp.z) > 0.08 && cp.y < level - 0.05 && groundHeight(cp.x, cp.z) < level ? 1 : 0;
  };
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
    // golf: from a tee, a round; while playing, stopped
    if (was === 'person' && golf.active) { golf.quit(); return; }
    if (was === 'person' && !p.sitting && !p.swing && !p.fallen && !p.chute && !p.onBus) {
      const tee = teeToPlay(p);
      if (tee >= 0) { golf.start(tee); return; }
    }
    // on a bench, a chair or the bleachers: up again; on a swing, a jump off it
    if (was === 'person' && p.sitting) { cm.standUp(); return; }
    if (was === 'person' && p.swing) { cm.leaveSwing(); return; }
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
    if (choice.swing) { cm.boardSwing(choice.swing); return; }
    const car = cm.entities.car;
    let drop = null;
    if (choice.parked || choice.moving || choice.machine || choice.rack || choice.stairs) {
      // the car the player had is left parked where it is (a machine from the road work, back on the ground there)
      drop = { ...cm.carLook, x: car.position.x, z: car.position.z, yaw: car.heading,
        y: Math.max(0, car.position.y - cm.getGroundHeight(car.position.x, car.position.z, 'car', -Infinity)) };
      if (car.machine === 'stairtruck') { airportPart.made.leaveStairs(drop.x, drop.z, drop.yaw); drop = null; }
      else if (car.machine) { roadWork.leave(drop.x, drop.z, drop.yaw); dropColliderCells(); drop = null; }
      if (choice.stairs) {
        // the airport's airstairs, driven off their spot; the car the player had is left parked
        if (drop) { const done = parkedCars.take(null, drop); if (done?.collider) addColliders([done.collider]); }
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
        if (drop) { const done = parkedCars.take(null, drop); if (done?.collider) addColliders([done.collider]); }
        const m = choice.machine;
        const look = roadWork.take(m.machine);
        dropColliderCells();
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
      if (drop) { const done = parkedCars.take(null, drop); if (done?.collider) addColliders([done.collider]); }
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
      const taken = choice.moving ? trafficSystem.takeCar(cm.entities.person.position.x, cm.entities.person.position.z, 5, () => cm.carLook) : null;
      if (choice.moving && !taken) { cm.entities.person.riding = null; return; }
      const done = parkedCars.take(choice.parked || null, drop);
      if (done?.collider) addColliders([done.collider]);
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
      kayakLaunches.release();
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
      kayakLaunches.release();
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
      h.position.set(was.x, restingHeight(was.x, was.z), was.z);
      h.heading = was.heading;
      h.speed = h.verticalSpeed = h.pitchAngle = h.rollAngle = 0;
      h.mesh.position.copy(h.position);
      h.mesh.rotation.y = h.heading;
      log(`[airport] took a parked ${was.kind}`);
    }
    if (choice.mode === 'car' && !choice.stairs && !choice.parked && !choice.moving && !choice.rack && !choice.machine &&
      car.machine === 'stairtruck' && !airportPart.made.stairsHeld) airportPart.made.claimStairs?.(car.position.x, car.position.z);
    selectMode(choice.mode);
    const stairsLeft = choice.mode === 'person' && was === 'car' && car.machine === 'stairtruck' && airportPart.made.stairsHeld;
    if (stairsLeft) parkStairs();
    if (choice.jump) cm.bailOut(choice.jump);
    // (airstairs jumped out of on the move stand where they were left: the truck they're driven as doesn't roll on
    // without them, which left a second one to drive away from the first)
    if (stairsLeft && car.coasting) { car.coasting = false; cm.stopCar(car); }
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

  // What stands in the road that traffic stops for rather than drives through (traffic.js setStillBodies): the vehicles
  // the players aren't in (the car stepped out of, the bike or bicycle left, the helicopter set down), the second
  // player's, and the cars the player left or a crash set rolling (parked-cars.js loose). Each with its position,
  // heading and half sizes; traffic.js passes over the one the first player is in and those off the ground or far off.
  const stillList = [], looseList = [];
  const bicycleBody = { position: null, heading: 0, boxW: 0.35, boxL: 0.95 };
  const heliBody = { position: null, heading: 0, boxW: 1.3, boxL: 4.2 };
  const bicycle2 = { ...bicycleBody }, heli2 = { ...heliBody };
  const bodyOf = (e, box) => { box.position = e.position; box.heading = e.heading; return box; };
  function stillBodies() {
    stillList.length = 0;
    const add = (cm, bike, heli) => {
      const active = cm.getActiveEntity();
      for (const [mode, e] of Object.entries(cm.entities)) {
        if (e === active || mode === 'person' || mode === 'kayak' || !e?.position) continue;
        stillList.push(mode === 'cyclist' ? bodyOf(e, bike) : mode === 'helicopter' ? bodyOf(e, heli) : e);
      }
    };
    add(controllerManager, bicycleBody, heliBody);
    if (split.drawn) {
      // (what the second player is in or on now traffic sees as it does the first player: trafficSystem.update)
      add(split.second.cm, bicycle2, heli2);
    }
    for (const c of parkedCars.loose?.(looseList) || []) {
      const o = c.collider.obb;
      stillList.push({ position: { x: o.cx, y: c.g + c.y, z: o.cz }, heading: c.yaw, boxW: c.halfW, boxL: c.halfL });
    }
    return stillList;
  }

  // How many people and cars are out: by Ann Arbor's hour, weekday and U-M's term (town-clock.js, for the hour shown:
  // the real one under Now, a look's own), and fewer people in rain, snow or hard cold
  function crowdBusy(timeId) {
    const t = townTime(timeId);
    const w = timeId === 'now' ? lightingSystem.weather : null;
    // (by the kind weather.js made of the report, as the rain and snow that fall are)
    const wet = w && (w.amount > 0 || w.kind === 'rain' || w.kind === 'storm' || w.kind === 'snow') ? 0.6 : 1;
    const cold = w && w.tempF != null && w.tempF < 25 ? 0.75 : 1;
    trafficSystem.setTrafficShare?.(trafficShare(t));
    highwayTraffic.setShare?.(Math.min(1, trafficShare(t) * 1.1));
    return [wet * cold, crowdShares(t)];
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId, timeId === 'now');
    setStreetLife(timeId, lightingSystem.weather); // the hour, date and weather the people go by (street-life.js)
    setShopHour(townTime(timeId).hour); // which kinds of business are open (shop-types.js)
    trafficSystem.setCrowdBusy?.(...crowdBusy(timeId));
    // rain or snow falls only under the real sky, and only then are the roads wet or slippery (road-feel.js)
    precipitation.set(timeId === 'now' ? lightingSystem.weather : null);
    setRoadWeather(timeId === 'now' ? lightingSystem.weather : null);
    fallingLeaves.set(timeId === 'now' ? lightingSystem.weather : null);
    colorGrade.applyPreset(lightingSystem.lookId, lightingSystem.lookBlend);
    split.view?.grade.applyPreset(lightingSystem.lookId, lightingSystem.lookBlend);
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
    if (timeId === 'now') describeNow();
  }
  // "Now": Ann Arbor's real sky, its sunrise and sunset worked out here, put on again every minute
  let nowCheckedAt = Date.now();
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

  // A champion tree found: within 40 m of one, a card rises over the middle of the screen with its name, its kind in
  // Latin, how big it is and how many of the city's champions you've found (kept with save('championFound')). Pressing
  // the card (or the pad's FLYOVER button) circles the camera slowly round the tree; moving, Back or the card again ends it.
  const CHAMPION_CONTROLS = { flyover: BUTTON.UP, back: BUTTON.B };
  const championFound = new Set(load('championFound') || []);
  document.querySelector('.champion-card')?.remove();
  const elChampion = document.createElement('div');
  elChampion.className = 'champion-card';
  elChampion.setAttribute('aria-live', 'polite');
  elChampion.setAttribute('role', 'button');
  elChampion.setAttribute('aria-label', 'Fly around the champion tree');
  document.body.appendChild(elChampion);
  const elChampionAction = document.createElement('div');
  elChampionAction.className = 'champion-action';
  let championNear = null, championShown = null, championCheckAt = 0, lastNow = 0, championFlying = false, signH = 160;
  // the landmark the place label names (renderLocation), to fly round with the view button
  let viewLandmark = null;
  const ft = (m) => Math.round(m * 3.28084);
  // the line under the tree's name: how to fly round it, or, while circling, how to come back (quietly)
  function drawChampionAction(on = input()) {
    const keys = on.kind === 'keyboard';
    const g = glyph(championFlying ? (keys ? 'Escape' : CHAMPION_CONTROLS.back) : (keys ? 'KeyT' : CHAMPION_CONTROLS.flyover));
    const words = championFlying ? ' to go back' : ' to fly around it';
    elChampionAction.replaceChildren(...(g ? [g, document.createTextNode(words)] : [document.createTextNode(championFlying ? 'Tap to go back' : 'Tap to fly around it')]));
  }
  onInput((on) => drawChampionAction(on));
  function showChampion(t, first) {
    if (first) { championFound.add(t.name); save('championFound', [...championFound]); }
    championShown = t;
    const el = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; };
    elChampion.replaceChildren(
      el('champion-kicker', first ? 'Champion tree found' : 'Champion tree'),
      el('champion-title', t.name),
      el('champion-latin', t.latin),
      el('champion-detail', `${ft(t.height)} ft tall · ${ft(t.spread)} ft across · ${Math.round(t.trunk * 39.37)} in trunk`),
      elChampionAction
    );
    drawChampionAction();
    if (first) { rumble(0, 0.25, 0.4, 0.3); log(`champion found: ${t.name} (${championFound.size}/${CHAMPION_TREES.length})`); }
  }
  // how tall and wide each landmark is, for the flyover's circle (a mural or sculpture is small; the rest a building)
  const VIEW_SIZE = { stadium: [45, 260], arb: [30, 220], gallup: [20, 160], westpark: [20, 140], fuller: [20, 160],
    burnspark: [20, 130], burton: [65, 40], diag: [30, 120], crisler: [30, 120], yost: [25, 90], huron: [25, 160], cascades: [10, 120] };
  function startChampionFlyover() {
    if (championFlying) return;
    const t = championShown;
    if (t) {
      cameraSystem.startFlyover(t.x, t.z, t.height, t.spread);
      elChampion.classList.add('flying', 'show');
      signH = elChampion.offsetHeight;
    } else if (viewLandmark) {
      const l = viewLandmark, [h, w] = VIEW_SIZE[l.id] || (l.art === 'golf' ? [15, 120] : l.art ? [6, 18] : [30, 80]);
      cameraSystem.startFlyover(l.x, l.z, h, w);
    } else return;
    championFlying = true;
    drawChampionAction();
    drawViewHint();
  }
  // the green sign hangs over the tree's crown in the world like a hologram, facing the camera, smaller farther off,
  // from when you reach the tree until you leave it
  const signAt = new THREE.Vector3();
  function placeChampionSign() {
    const t = championShown;
    if (!t || !championFlying) return;
    const cam = cameraSystem.camera;
    signAt.set(t.x, groundHeight(t.x, t.z) + t.height * 1.02 + 2, t.z);
    const dist = signAt.distanceTo(cam.position);
    signAt.project(cam);
    const box = renderer.domElement.getBoundingClientRect();
    const behind = signAt.z > 1;
    const x = box.left + (signAt.x * 0.5 + 0.5) * box.width;
    const y = box.top + (0.5 - signAt.y * 0.5) * box.height;
    const k = Math.max(0.6, Math.min(0.9, 45 / dist)) * Math.min(1, box.height / 1080 * 1.4);
    elChampion.style.left = `${x.toFixed(1)}px`;
    // kept below the toolbar when the crown is above the top of the screen
    elChampion.style.top = `${Math.max(box.top + 110 + signH * k, y).toFixed(1)}px`;
    elChampion.style.transform = `translate(-50%, -100%) scale(${k.toFixed(3)})`;
    elChampion.style.visibility = behind ? 'hidden' : '';
  }
  function endChampionFlyover() {
    if (!championFlying) return;
    championFlying = false;
    cameraSystem.endFlyover();
    elChampion.classList.remove('flying', 'show');
    drawChampionAction();
    drawViewHint();
  }
  elChampion.addEventListener('click', () => (championFlying ? endChampionFlyover() : startChampionFlyover()));
  // the keys (the page reads them itself): T flies round the tree whose card is up; Escape or a driving key comes back
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e) || e.repeat || e.metaKey || e.ctrlKey || e.altKey || mapSystem.isFullMapOpen) return;
    if (championFlying && /^(Escape|Key[WASDT]|Arrow)/.test(e.code)) endChampionFlyover();
    else if (!championFlying && (championShown || viewLandmark) && e.code === 'KeyT') startChampionFlyover();
  });
  function updateChampion(now, pos) {
    lastNow = now;
    if (now < championCheckAt) return;
    championCheckAt = now + 400;
    // the nearest within 40 m (two champions can stand a few metres apart), its card shown as it becomes the nearest
    let near = null, nearest = 40 * 40;
    for (const t of CHAMPION_TREES) {
      const dx = t.x - pos.x, dz = t.z - pos.z, d = dx * dx + dz * dz;
      if (d < nearest) { near = t; nearest = d; }
    }
    if (near && near !== championShown && !championFlying) showChampion(near, !championFound.has(near.name));
    // gone well away from it: the next visit shows its card again
    if (championNear && !near) {
      const dx = championNear.x - pos.x, dz = championNear.z - pos.z;
      if (dx * dx + dz * dz < 60 * 60) return;
      endChampionFlyover();
      elChampion.classList.remove('show');
      championShown = null;
    }
    championNear = near;
  }
  // the pad, each frame: the flyover button while the card is up; Back or moving ends the flyover
  function championPad(pad) {
    if (!pad) return;
    if (championFlying) {
      if ((pad.pressed & (CHAMPION_CONTROLS.back | CHAMPION_CONTROLS.flyover)) || Math.hypot(pad.lx, pad.ly) > 0.4 || pad.rt > 0.2 || pad.lt > 0.2) endChampionFlyover();
    } else if ((championShown || viewLandmark) && (pad.pressed & CHAMPION_CONTROLS.flyover)) startChampionFlyover();
  }

  // Lamp: buses where the player stands (theride.js departures, traffic.js busesDue/busRide), four times a second. On
  // foot within 6 m of a stop's sign: its next buses by the timetable and the live delay, "4 · Ypsilanti · 6 min".
  // On a bus: "Next: Washtenaw & Stadium", the stop it makes next, and a soft chime as it pulls in there.
  let chimedStop = -2;
  const clock12 = (sec) => { const h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  function busLine() {
    const cm = controllerManager, p = cm.entities.person;
    if (cm.activeMode !== 'person') { chimedStop = -2; return null; }
    if (p.onBus) {
      const ride = trafficSystem.busRide();
      if (!ride?.nextStop) return null;
      // (not for the stop the player got on at)
      if (chimedStop === -2) chimedStop = ride.stopped ? ride.nextStopIx : -1;
      else if (ride.stopped && chimedStop !== ride.nextStopIx) { chimedStop = ride.nextStopIx; audioSystem.cue('buschime', p.position, 0.8); }
      return { place: ride.stopped ? ride.nextStop : `Next: ${ride.nextStop}` };
    }
    chimedStop = -2;
    const due = trafficSystem.busesDue(p.position.x, p.position.z, 6);
    if (!due) return null;
    if (!due.length) return { lines: ['No more buses today'] };
    return { lines: due.map((d) => `${d.um ? d.name : d.short} · ${d.headsign} · ${d.secs < 30 ? 'Now' : d.secs < 3600 ? `${Math.max(1, Math.round(d.secs / 60))} min` : clock12(d.clock)}`) };
  }

  // Where you are: the place's name over its street corner, drawn as a pair of green street-name signs
  const roadNames = new Set(ROADS.map((r) => r.name));
  const placeNames = new Set(LANDMARKS.flatMap((l) => (l.art ? [l.name, l.short] : [l.name])));
  let locationText = '';
  const elViewHint = document.createElement('span');
  elViewHint.className = 'location-view';
  // (on a touch screen, with no button to name, the hint itself is pressed: "Tap to view")
  elViewHint.style.pointerEvents = 'auto';
  elViewHint.addEventListener('click', () => (championFlying ? endChampionFlyover() : startChampionFlyover()));
  function drawViewHint(on = input()) {
    const keys = on.kind === 'keyboard';
    const g = glyph(championFlying ? (keys ? 'Escape' : CHAMPION_CONTROLS.back) : (keys ? 'KeyT' : CHAMPION_CONTROLS.flyover));
    elViewHint.replaceChildren(g ? g : '', document.createTextNode(g ? (championFlying ? ' to go back' : ' to view') : (championFlying ? 'Tap to go back' : 'Tap to view')));
  }
  onInput((on) => drawViewHint(on));
  // `bus`: on a bus, the stop it makes next in place of the place's name ({ place }); at a stop's sign, the next buses
  // from it, a plain line each under the name ({ lines }: busLine)
  // A new place or corner shows once it has held for a moment (0.7 s), so passing a side street or the edge of a
  // park doesn't flick the signs back and forth; the first label, a teleport's arrival and the bus lines show at once
  let locationPending = null, locationPendingAt = 0;
  function renderLocation(label, bus = null) {
    const key = bus ? `${label}\n${bus.place || ''}\n${(bus.lines || []).join('\n')}` : label;
    if (!elLocation || key === locationText) { locationPending = null; return; }
    if (locationText && !bus && !arrival) {
      const now = performance.now();
      if (key !== locationPending) { locationPending = key; locationPendingAt = now; return; }
      if (now - locationPendingAt < 700) return;
    }
    locationPending = null;
    locationText = key;
    // what's shown already stays as it is; only what's new fades in (`fresh`)
    const shownPlace = elLocation.querySelector('.location-place')?.firstChild?.textContent || '';
    const shownSigns = new Set([...elLocation.querySelectorAll('.street-sign')].map((s) => s.textContent));
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
    if (bus?.place) place = bus.place;
    const nodes = [];
    // a landmark (a building, park, mural, sculpture or champion tree) can be flown round: "T to view" beside its name
    viewLandmark = null;
    if (place) {
      const at = controllerManager.getActiveEntity()?.position || cameraSystem.currentPos;
      let best = Infinity;
      for (const l of LANDMARKS) {
        if (l.name !== place && l.short !== place) continue;
        const d = (l.x - at.x) ** 2 + (l.z - at.z) ** 2;
        if (d < best) { best = d; viewLandmark = l; }
      }
    }
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place' + (place === shownPlace ? ' kept' : '');
      el.textContent = place;
      if (viewLandmark) { el.appendChild(elViewHint); drawViewHint(); }
      nodes.push(el);
    }
    for (const line of bus?.lines || []) {
      const el = document.createElement('div');
      el.className = 'location-bus';
      el.textContent = line;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs kept';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'near';
        row.appendChild(near);
      }
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        // (the Border to Border Trail's in a park sign's brown)
        sign.className = 'street-sign' + (name === B2B_NAME ? ' trail-sign' : '') + (shownSigns.has(name) ? '' : ' fresh');
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

  // the landmark last teleported to, and where the player landed for it (the teleport buttons, below)
  let arrival = null;
  function teleportTo(x, z, heading = Math.PI, lookUp) {
    arrival = null;
    endChampionFlyover();
    const destination = controllerManager.teleportActiveTo(x, z, heading);
    log(`[teleport] asked ${x.toFixed(1)}, ${z.toFixed(1)} → landed ${destination.x.toFixed(1)}, ${destination.z.toFixed(1)} as ${controllerManager.activeMode}`);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    // a tall landmark's viewpoint looks up at it, until the player moves off
    if (Number.isFinite(lookUp)) cameraSystem.lookUp = lookUp;
    // arrived: no GPS route left to follow
    mapSystem.waypoint = null;
    return destination;
  }

  let mapOpenedAt = null; // when the full map last opened (the frame stops drawing the city under it)
  const mapSystem = new CityMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    allBlocks: cityBlocks.allBlocks,
    onToggle: (open) => {
      mapOpenedAt = open ? performance.now() : null;
      controllerManager.resetInput();
      // the arrows and Space are the map's while it's open (controllers.js onKey)
      controllerManager.keysSuspended = open;
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
  // bike racks and bus stops, as small dots once zoomed in (city-map.js drawSpots)
  mapSystem.workSites = (roadWork?.closures || []).map((e) => ({ x: e.sx + e.dx * e.len / 2, z: e.sz + e.dz * e.len / 2 }));

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      const loc = TELEPORT_LOCATIONS[key];
      if (loc) {
        // a place to arrive at on foot (the Cube, to push it)
        if (loc.foot && controllerManager.activeMode !== 'person') selectMode('person');
        // a trail to ride (the Border to Border Trail): on the bike
        if (loc.bike && controllerManager.activeMode !== 'cyclist') selectMode('cyclist');
        const at = teleportTo(loc.x, loc.z, loc.heading, loc.lookUp);
        // the place label names the landmark arrived at while the player stays at its viewpoint (city-config.js)
        if (LANDMARKS.some((l) => l.id === key)) arrival = { id: key, x: at.x, z: at.z };
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
      // closed or opened, by the player or for a touch screen: it stays as it is now
      hudChosen = true;
    });
    cleanViewOnTouch();
  }

  // Global keyboard shortcuts for modes (1-5), getting in and out (F), cameras (V / 6-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    // (with the full map over the city its keys are the map's; a held key's repeats and Cmd, Ctrl or Option with a key
    // are left alone, so holding V doesn't race through the cameras or Cmd+1 change vehicle)
    if (isTypingInField(e) || mapSystem.isFullMapOpen || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
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
        getInOrOut();
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyN':
        audioSystem.setEnabled(!audioSystem.enabled);
        break;
      case 'KeyR':
        carRadio.tune(e.shiftKey ? -1 : 1);
        break;
      case 'KeyB':
        audioSystem.honk(controllerManager.getActiveEntity());
        break;
      case 'KeyL':
        toggleSiren();
        break;
    }
  });

  window.addEventListener('resize', () => {
    placeModeIndicator();
    fitHints();
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
  // 15 minutes by the clock (not of play: after the lid's been shut or the page hidden, at once on its first frame back)
  let weatherAskedAt = -Infinity;
  const askWeather = () => {
    weatherAskedAt = Date.now();
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

    // On an Xbox, or without shadows (a phone), and with no warm-up frame there, only what's within
    // LATER_BEYOND of where the player starts is compiled behind the loading screen; the rest compiles while they play,
    // a few at a time, well before they get there. ANGLE on the Xbox makes each shader slowly, and most are far off.
    const later = [];
    if (!QUALITY.shadows || XBOX) {
      const { x, z } = groundStreamCenter();
      const near = (o) => {
        if (!o.geometry) return true;
        let sphere = o.isInstancedMesh ? (o.boundingSphere ?? (o.computeBoundingSphere?.(), o.boundingSphere)) : null;
        if (!sphere) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); sphere = o.geometry.boundingSphere; }
        if (!sphere) return true;
        compileSphere.copy(sphere).applyMatrix4(o.matrixWorld);
        return Math.hypot(compileSphere.center.x - x, compileSphere.center.z - z) - compileSphere.radius < LATER_BEYOND;
      };
      for (let i = jobs.length - 1; i >= 0; i--) if (!jobs[i].some(near)) later.push(...jobs.splice(i, 1));
    }

    await showLoadingStage(`Compiling scene shaders... 0 / ${jobs.length} batches`);
    setLoadingProgress(0);
    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(sceneMRT);
    // one of each shader (warmKey: its materials, attributes, instancing and shadows), as compileLater and warmAhead
    // do: each compileAsync walks the whole scene, and the meshes that share a shader with one already done need none
    const compiledKeys = new Set();
    const compile = async (object) => {
      if (object.isMesh && object.geometry?.attributes) {
        const key = object.userData.warmKey ??= warmKey(object);
        if (compiledKeys.has(key)) return;
        compiledKeys.add(key);
      }
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
    if (later.length) compileLater(later);
  }
  const LATER_BEYOND = 450, compileSphere = new THREE.Sphere();
  // The shaders left for later, one at a time between frames: each takes the scene pass's target and every object
  // drawn unculled only while it's taken (compileAsync reads them at once, then waits for the GPU's compile)
  // (`detached`: objects made only to compile, in no scene: the cars a player might take, controllers.js)
  // (`unshadowed`: the shaders as split screen draws them, without the sun's shadows: see warmSplit)
  async function compileLater(jobs, { detached = false, what = 'far parts', unshadowed = false } = {}) {
    const began = performance.now();
    let count = 0;
    // one of each material and geometry layout (as warmAhead does): the objects that share one share its shader
    const seen = new Set();
    for (const job of jobs) for (const object of job) {
      if (!object.parent && !detached) continue;
      if (object.isMesh && object.geometry?.attributes) {
        const key = object.userData.warmKey ??= warmKey(object);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!detached && !unshadowed) warmSeen.add(key);
      }
      await nextTask();
      if (!object.parent && !detached) continue;
      const wasCulled = [];
      object.traverse((o) => { if (o.frustumCulled) { wasCulled.push(o); o.frustumCulled = false; } });
      renderer.setRenderTarget(scenePass.renderTarget);
      renderer.setMRT(sceneMRT);
      // (the shadows' setting is part of each shader's key, read as compileAsync sets the object up)
      const shadowsWere = renderer.shadowMap.enabled;
      if (unshadowed) renderer.shadowMap.enabled = false;
      let done;
      try { done = renderer.compileAsync(object, cameraSystem.camera, scene); } catch (e) { console.warn('[compile]', e); }
      renderer.shadowMap.enabled = shadowsWere;
      renderer.setMRT(null);
      renderer.setRenderTarget(null);
      for (const o of wasCulled) o.frustumCulled = true;
      await Promise.resolve(done).catch(() => {});
      if (detached) object.traverse((o) => o.geometry?.dispose());
      count++;
    }
    log(`[compile] ${count} shaders of ${what} compiled during play, in ${Math.round((performance.now() - began) / 1000)} s`);
  }

  // Lamp: on the Xbox, where ANGLE makes each shader slowly, the shaders of what's within `warmReach` of the player are
  // made ahead of them, nearest first, one between frames: the hidden too (a tree cell, a street square, a house just
  // streamed in), which would otherwise be made on the frame each first shows (arriving somewhere new stuttered for
  // ~10 s). One of each material and geometry layout is enough; the scene's looked over every two seconds.
  const warmSeen = new Set(), warmChecked = new WeakSet(), warmQueue = [], warmSphere = new THREE.Sphere();
  // (looked over again sooner when the last look found something, later, up to every 16 s, when it found nothing,
  // and at once after the camera has gone 150 m: a walk of the whole scene costs a frame a millisecond or more there)
  let warmScanAt = 3, warming = false, warmEvery = 2;
  const warmFrom = { x: Infinity, z: Infinity };
  const warmKey = (o) => `${[o.material].flat().map((m) => m.id).join(',')}|${Object.keys(o.geometry.attributes).sort().join(',')}|${o.geometry.index ? 'i' : 'p'}|${o.isInstancedMesh ? 'n' : ''}${o.isBatchedMesh ? 'b' : ''}${o.castShadow ? 's' : ''}${o.receiveShadow ? 'r' : ''}${o.instanceColor ? 'c' : ''}${o.morphTexture ? 'm' : ''}`;
  const warmDistance = (o, x, z) => {
    const s = (o.isInstancedMesh && o.boundingSphere) || o.geometry.boundingSphere;
    if (!s) return 0;
    warmSphere.copy(s).applyMatrix4(o.matrixWorld);
    return Math.max(0, Math.hypot(warmSphere.center.x - x, warmSphere.center.z - z) - warmSphere.radius);
  };
  function warmAhead(now) {
    const { x, z } = cameraSystem.camera.position;
    if (now < warmScanAt && Math.hypot(x - warmFrom.x, z - warmFrom.z) < 150) return;
    warmFrom.x = x; warmFrom.z = z;
    const queued = warmQueue.length;
    scene.traverse((o) => {
      if (warmChecked.has(o) || !o.isMesh || !o.geometry?.attributes.position || o.userData.shadowProxy || !o.layers.test(cameraSystem.camera.layers)) return;
      const key = o.userData.warmKey ??= warmKey(o);
      if (warmSeen.has(key)) { warmChecked.add(o); return; }
      if (warmDistance(o, x, z) > TIER.warmReach) return;
      warmSeen.add(key);
      warmChecked.add(o);
      warmQueue.push(o);
    });
    warmEvery = warmQueue.length > queued ? 2 : Math.min(16, warmEvery * 2);
    warmScanAt = now + warmEvery;
    if (!warming && warmQueue.length) warmQueued();
  }
  async function warmQueued() {
    warming = true;
    let count = 0;
    while (warmQueue.length) {
      await nextTask();
      // the nearest to where the player is now
      const { x, z } = cameraSystem.camera.position;
      let best = 0;
      for (let i = 1; i < warmQueue.length; i++) if (warmDistance(warmQueue[i], x, z) < warmDistance(warmQueue[best], x, z)) best = i;
      const object = warmQueue.splice(best, 1)[0];
      if (!object.parent) { warmSeen.delete(object.userData.warmKey); continue; }
      const wasVisible = object.visible, wasCulled = object.frustumCulled;
      object.visible = true; object.frustumCulled = false;
      renderer.setRenderTarget(scenePass.renderTarget);
      renderer.setMRT(sceneMRT);
      let done;
      try { done = renderer.compileAsync(object, cameraSystem.camera, scene); } catch (e) { console.warn('[compile]', e); }
      renderer.setMRT(null);
      renderer.setRenderTarget(null);
      object.visible = wasVisible; object.frustumCulled = wasCulled;
      await Promise.resolve(done).catch(() => {});
      count++;
    }
    warming = false;
    if (count > 2) log(`[compile] ${count} shaders of what's near made ahead of the player`);
  }

  // Lamp's preview plays out of sight, frame by frame, with no screen to wait for: the warm-up frame compiles there.
  if (!window.lampPreview && !warmStart) await precompileShaders();
  markInit('compile');
  await showLoadingStage('Preparing shadows and the first frame...');

  // 6. The frame, which Lamp's runtime calls about 60 times a second (and its preview at exactly 1/60 s)
  let elapsed = 0;
  let frameCount = 0;
  let checkTick = 0, wasSplit = false;
  const lastChecked = new THREE.Vector3(1e9, 0, 1e9);
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let heardStrokes = 0;
  const animalCtx = { camera: cameraSystem.camera, player: null, mode: 'car', look: 'midday', cars: trafficSystem.cars, buses: trafficSystem.buses, paddlers: riverPeoplePart.made.people || [], trains: railways.trains, colliders: allColliders, cue: (k, at, i) => audioSystem?.cue(k, at, i) };
  let warmedUp = false; // see the first frame below

  if (elFps) elFps.textContent = '60';

  // Lamp: what each frame's work costs on this machine, logged every ten seconds (milliseconds a frame on average, and
  // the draws and triangles a frame), to see what slows it down
  // (and the slowest frame's own parts, to see what a stutter is made of)
  const prof = { t: 0, n: 0, parts: new Map(), cur: new Map(), worst: 0, worstLine: '', draws: 0, tris: 0, next: 10 };
  let profAt = 0;
  const mark = (name) => {
    const t = performance.now();
    prof.parts.set(name, (prof.parts.get(name) || 0) + (t - profAt));
    prof.cur.set(name, (prof.cur.get(name) || 0) + (t - profAt));
    profAt = t;
  };
  renderer.info.autoReset = false;

  // A computer whose own work on a frame is too much starts lighter from then on (device-tier.js `slow`): the city's
  // logic and the drawing it hands the graphics (the profile above) over 50 ms, so it couldn't make 20 frames a second
  // however fast the screen. Judged by that work, never by frames a second, which a screen that refreshes 30 times a
  // second holds at 30 however little each frame takes. Only when it holds: most frames of two half-minutes running,
  // once the city's in, with one view drawn and no map over it or recording. A phone, an Xbox and the slow city
  // itself are left as they are.
  // The mark is a measurement, not a verdict: it lapses after a week (device-tier.js), Reset game clears it, it steps
  // down one tier at a time (full to light, then light to slow), and a lighter city started by it that runs with
  // plenty to spare (under 10 ms of work in most frames of two half-minutes running) clears it for the next start.
  // Nothing's judged in a page whose code was changed while it ran, which slows it until it's loaded again.
  const SLOW_WORK_MS = 50, EASY_WORK_MS = 10;
  const slowWatch = { t: 0, n: 0, over: 0, easy: 0, work: 0, windows: 0, easyWindows: 0, told: false, marked: !!load('slowWork') };
  function watchWork(ms, rawDt) {
    if (slowWatch.told || qualityChoice() !== 'auto' || (TIER.name !== 'full' && TIER.name !== 'light' && !(TIER.name === 'slow' && slowWatch.marked))) return;
    if (liveRuns.n > 1 || elapsed < 45 || rawDt > 0.5 || document.hidden || split.drawn || mapSystem.isFullMapOpen || videoRecorder.recording) return;
    slowWatch.t += rawDt; slowWatch.n++; slowWatch.work += ms;
    if (ms > SLOW_WORK_MS) slowWatch.over++;
    if (ms < EASY_WORK_MS) slowWatch.easy++;
    if (slowWatch.t < 30) return;
    // (two half-minutes running, so a burst of building after a teleport doesn't count)
    const share = slowWatch.over / slowWatch.n, average = slowWatch.work / slowWatch.n;
    slowWatch.windows = TIER.name !== 'slow' && share > 0.75 ? slowWatch.windows + 1 : 0;
    slowWatch.easyWindows = slowWatch.marked && slowWatch.easy / slowWatch.n > 0.9 ? slowWatch.easyWindows + 1 : 0;
    if (slowWatch.windows >= 2) {
      slowWatch.told = true;
      save('slowWork', { ms: Math.round(average), at: Date.now(), from: TIER.name });
      log(`[tier] ${average.toFixed(0)} ms of work a frame (${Math.round(share * 100)}% of frames over ${SLOW_WORK_MS} ms, slowest ${prof.worstLine || '?'}): ${TIER.name === 'full' ? 'light' : 'slow'} from the next start`);
    } else if (slowWatch.easyWindows >= 2) {
      slowWatch.told = true;
      save('slowWork', null);
      log(`[tier] ${average.toFixed(1)} ms of work a frame on ${TIER.name}: the fuller city again from the next start`);
    }
    slowWatch.t = slowWatch.n = slowWatch.over = slowWatch.easy = slowWatch.work = 0;
  }

  // Split screen (split-screen.js): with a second controller connected, View on either controller puts that player in
  // the right half and the first in the left, and back to one view again. It steps aside while only one controller is
  // connected and comes back with the second. Kept through a change of the code (snapshot below).
  const asController = () => { const on = input(); return on.kind === 'controller' ? on : { ...on, kind: 'controller' }; };
  function splitNotice(lead) {
    const key = label(BUTTON.VIEW, asController());
    if (key) showNotice(`${lead}: press ${key} for split screen`, 3.5);
  }
  function joinSecondPlayer() {
    if (split.second) return;
    const cm = controllerManager;
    split.second = createSecondPlayer({ scene, colliders: allColliders, beside: cm, map: mapSystem, kept: split.kept,
      share: { knockdowns: cm.knockdowns, parkedCars: cm.parkedCars, railways: cm.railways, potholes: cm.potholes, parking: cm.parking,
        playTop: cm.playTop, swings: cm.swings, skatePark: cm.skatePark, bleachers: cm.bleachers, mtbTrails: cm.mtbTrails, bikeRoutes: cm.bikeRoutes, pools: cm.pools, riverScale: cm.riverScale,
        // the humps' jolts and the road work's dirt pile to drive up (its machines are the first player's to take)
        speedHumps: cm.speedHumps, roadWork: { pileTop: (x, z) => roadWork.pileTop(x, z), nearestMachine: () => null } } });
    // the boxes that come and go as the city streams are patched into their cells too (addColliders)
    colliderManagers.push(split.second.cm);
    split.kept = null;
    dynamicRoots.push(...Object.values(split.second.cm.entities).flatMap((e) => [e.mesh, e.helmet]).filter(Boolean));
  }
  // Split screen draws without the sun's shadows, which makes every shader in view anew: made in the background once a
  // second controller connects, one of each between frames, so pressing View doesn't hold the game still while they
  // compile in its first frame
  function warmSplit() {
    const meshes = [];
    scene.traverseVisible((o) => { if (o.isMesh && o.geometry?.attributes.position && !o.userData.shadowProxy) meshes.push(o); });
    compileLater([meshes], { what: 'split screen', unshadowed: true });
  }
  // Each half's camera as wide as its half; one view again, the first camera as wide as the screen
  function showSplit(on) {
    if (on === split.drawn) return;
    split.drawn = on;
    if (on) {
      joinSecondPlayer();
      split.view ??= createSplitView(renderer, { samples: QUALITY.antialias ? 4 : 0 });
      split.view.grade.applyPreset(lightingSystem.lookId, lightingSystem.lookBlend);
    }
    fitCameras();
    // each half draws everything again: no sun shadows while there are two (soft shade on the ground instead)
    renderer.shadowMap.enabled = QUALITY.shadows && !on;
    document.body.classList.toggle('split', on);
    log(`[split] ${on ? 'two views side by side' : 'one view'}`);
  }

  let frameAt = 0; // (when the last frame began, by the clock: see rawDt)
  let radarTick = false;
  const frame = (f) => {
    profAt = performance.now();
    prof.cur.clear();
    renderer.info.reset();
    const now = f.time * 1000;
    // the real time since the last frame, by the clock (f.dt is held to 0.05 s for the game's own step, so a badge or a
    // recording clock read from it couldn't go below 20 frames a second): the frame-rate badge, the slow watch and
    // the recording's length
    const rawDt = frameAt ? (profAt - frameAt) / 1000 : f.dt;
    frameAt = profAt;
    const dt = Math.min(Math.max(f.dt, 0.001), 0.05);
    elapsed += dt;
    tickNotice(dt);
    watchDate();
    knockdowns.update(dt);
    // a cart, can or bench sent flying knocks down whoever it reaches: a walker goes limp, a rider comes off
    for (const it of knockdowns.flying) {
      const fl = it.fly;
      if (fl.vx * fl.vx + fl.vz * fl.vz < 6 || !trafficSystem.knockBy) continue;
      if (trafficSystem.knockBy(fl.x, fl.y, fl.z, 0.85, fl.vx, fl.vz)) {
        fl.vx *= 0.45; fl.vz *= 0.45;
        audioSystem?.cue('thud', { x: fl.x, y: fl.y, z: fl.z }, 0.6);
        log(`[knock] a flying ${it.kind} knocked someone down`);
      }
    }
    hydrantSpray.update(dt, cameraSystem.camera);
    audioSystem?.gush?.(hydrantSpray.gushes(gushList));
    skidEffects.update(dt, controllerManager.entities.car, controllerManager.activeMode === 'car', cameraSystem.camera);

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    if (!mapSystem.isFullMapOpen) championPad(f.pads[0]);
    gamepadControls.supply(f.pads[0]);
    gamepadControls.update(dt);
    golf.update(dt);
    // the playground swings: those ridden or still swinging, and the empty ones near a player swaying in the wind
    if (controllerManager.swings) {
      swingFoci[0] = controllerManager.entities.person.position;
      swingFoci[1] = split.drawn ? split.second?.cm.entities.person.position : null;
      controllerManager.swings.update(dt, swingFoci, swingCreak);
    }
    controllerManager.update(dt, elapsed, cameraSystem.initialized ? cameraSystem.currentPos : null);
    {
      const cm = controllerManager, look = cm.carLook;
      const mode = cm.activeMode, inCar = mode === 'car' && !cm.entities.car.bike;
      carRadio.update(dt, { inCar, carKey: look && `${look.kind}:${look.hex}:${look.style ?? 0}`,
        own: Boolean(look && isOwnLook(look)), phones: !inCar && mode !== 'helicopter', soundOn: audioSystem.enabled });
      cm.earbuds = carRadio.earbuds; // white earbuds on the player while one plays (controllers.js)
    }
    // the protected bike lanes' flex posts fold under the car and spring back, and their curbs jolt it (bike-routes.js)
    {
      const cm = controllerManager, car = cm.activeMode === 'car' ? cm.entities.car : null;
      bikeRoutesPart.made.update?.(dt, car, (kind, x, z, strength) => {
        audioSystem?.cue('thud', { x, y: groundHeight(x, z), z }, kind === 'curb' ? 0.5 + strength * 0.5 : 0.25 + strength * 0.35);
        rumble(0, kind === 'curb' ? 0.4 + strength * 0.5 : 0.15 + strength * 0.2, kind === 'curb' ? 0.3 + strength * 0.4 : 0.2, kind === 'curb' ? 0.2 : 0.1);
        if (kind === 'curb' && strength > 0.7) log('[bike routes] hit a lane curb hard');
      });
    }
    // parked cars a crash shoved, sliding to a stop (parked-cars.js), and found where they are now
    for (const col of parkedCars.step(dt, (p) => controllerManager.settleParked(p))) for (const cm of colliderManagers) cm.refreshCollider(col);
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
    {
      // a second controller: offered split screen once, and View on either controller turns it on and off
      const two = Boolean(f.pads[1]?.connected);
      if (two && !split.offered && !split.on) { split.offered = true; splitNotice('Second controller'); }
      if (two && QUALITY.shadows && !split.warmed) { split.warmed = true; warmSplit(); }
      if (two && ((f.pads[0].pressed | f.pads[1].pressed) & BUTTON.VIEW)) {
        split.on = !split.on;
        if (!split.on) splitNotice('One view');
      }
      showSplit(split.on && two);
      if (split.drawn) split.second.update(dt, elapsed, f.pads[1], !mapSystem.isFullMapOpen);
    }
    tickRecording(rawDt);
// the camera under the river's surface: murky green fog and a tint over the view
    {
      const under = underAt(cameraSystem.camera.position);
      if (lightingSystem.uUnder) lightingSystem.uUnder.value = under;
      // in split screen the tint over the half whose camera is under (each half's fog is set as it's drawn, below)
      const under2 = split.drawn ? underAt(split.second.camera.position) : 0;
      const shown = split.drawn ? `${under}${under2}` : `${under}`;
      if (shown !== lastUnder) {
        if (under !== +String(lastUnder)[0]) log(under ? '[underwater] the camera went under the river' : '[underwater] the camera came up');
        lastUnder = shown;
        underwaterEl.style.opacity = under || under2 ? '1' : '0';
        underwaterEl.style.clipPath = !split.drawn || (under && under2) ? '' : under ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)';
      }
    }
    streetDetails.signalClock.value = elapsed;
    controlsPart.made.update(elapsed);
    trafficSystem.setStillBodies?.(stillBodies());
    syncSiren();
    trafficSystem.update(
      dt,
      elapsed,
      cameraSystem.currentPos,
      controllerManager.getActiveEntity(),
      controllerManager.activeMode,
      cameraSystem.camera,
      split.drawn ? split.second.camera : null,
      split.drawn ? split.second.cm.getActiveEntity() : null,
      split.drawn ? split.second.cm.activeMode : null
    );
    mark('player & traffic');
    highwayTraffic.update(dt, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode);
    mark('highway');
    railways.update(dt, (at, hold, kind) => audioSystem.trainHorn(at, hold, kind), (crossings) => audioSystem.crossingBells(crossings));
    // (in split screen the second player's camera too: parked-cars.js keeps the cells near either)
    parkedCars.update(cameraSystem.camera, split.drawn ? split.second.camera : null);
    // (the cameras, so the work zones' town-wide meshes are hidden while no player is near one: road-work.js cull)
    roadWork.update(dt, controllerManager.getActiveEntity(), controllerManager.activeMode, trafficSystem.cars, trafficSystem.buses,
      [cameraSystem.camera, split.drawn ? split.second.camera : null]);
    // the second player knocks the cones and drums over too (no time passes in this call: the first moved them on)
    if (split.drawn) roadWork.update(0, split.second.cm.getActiveEntity(), split.second.cm.activeMode, [], []);
    riverPeoplePart.made.update(dt, elapsed, cameraSystem.currentPos, split.drawn ? split.second.camera.position : null);
    liveryPart.made.update(dt, elapsed, cameraSystem.currentPos,
      controllerManager.activeMode === 'person' ? controllerManager.entities.person.position : null);
    planesPart.made.update(dt, lightingSystem.lookId);
    shopRoomsPart.made.update(dt, cameraSystem.currentPos, split.drawn ? split.second.camera.position : null);
    scootersPart.made.update(dt, cameraSystem.currentPos, controllerManager.getActiveEntity(), controllerManager.activeMode, rackCue);
    racksPart.made.update(dt, cameraSystem.currentPos, controllerManager.getActiveEntity(), controllerManager.activeMode, rackCue);
    airportPart.made.update?.(dt, cameraSystem.currentPos);
    {
      // the truck the player drove the airstairs as is hidden while the airstairs it left stand in its place
      const c = controllerManager.entities.car;
      if (c.machine === 'stairtruck' && controllerManager.activeMode !== 'car' && !airportPart.made.stairsHeld) {
        c.mesh.visible = !airportPart.made.nearestStairs?.(c.position.x, c.position.z, 1);
      }
    }
    moonPart.made.update(cameraSystem.camera);
    starsPart.made.update(cameraSystem.camera, starsAt(cameraSystem.camera));
    mark('trains & parked');
    animalCtx.player = controllerManager.getActiveEntity();
    animalCtx.mode = controllerManager.activeMode;
    animalCtx.player2 = split.drawn ? split.second.cm.getActiveEntity() : null;
    animalCtx.mode2 = split.drawn ? split.second.cm.activeMode : null;
    animalCtx.look = lightingSystem.lookId;
    animalCtx.paddlers = riverPeoplePart.made.people || animalCtx.paddlers;
    // Lamp: no animals on the Xbox (their tree lookups stalled frames there by 100-170 ms; the person chose to do without)
    if (!XBOX) animalsPart.made.update(dt, elapsed, animalCtx);
    mark('animals');
    // the dial's name follows whatever the player is in, however they got into it
    const dialLabel = controllerManager.getActiveEntity()?.label;
    if (elMode && dialLabel && dialLabel !== elMode.dataset.label) setDialName(dialLabel);
    const kayak = controllerManager.entities.kayak;
    if (kayak.strokes !== heardStrokes) {
      heardStrokes = kayak.strokes;
      // on the side the blade went in, a little stronger the harder it's pulled
      if (controllerManager.activeMode === 'kayak' && kayak.boat !== 'paddleboat') {
        const side = kayak.strokeSide || 0, h = kayak.heading;
        audioSystem.cue('paddle', { x: kayak.position.x + Math.cos(h) * side * 0.9, y: kayak.position.y, z: kayak.position.z - Math.sin(h) * side * 0.9 }, Math.min(1, 0.5 + Math.abs(kayak.speed) * 0.12));
      }
    }
    // white water off the bow in the Argo Cascades (controllers.js kayakSpray)
    for (const s of kayak.sprays?.splice(0) || []) {
      waterSplash.spray(s.x, s.y, s.z, s.vx, s.vz, s.strength);
      if (s.strength > 0.5) audioSystem.cue('splash', s, Math.min(1, s.strength));
    }
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    if (outskirts.update) outskirts.update(elapsed);
    mark('misc');
    {
      // (in split screen round the second player's view too)
      const two = split.drawn ? split.second.camera.position : null;
      cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z, false, two?.x, two?.z);
    }
    // (the shops' pooled lights only with the clustered lighting: without it they were taken out of the scene)
    if (cityBlocks.updateLights && QUALITY.streetLights) cityBlocks.updateLights(cameraSystem.camera);
    mark('blocks');
    // (the trees near the second player's camera too in split screen, each at the level of the nearer: trees.js)
    if (streetDetails.update) streetDetails.update(cameraSystem.camera, split.drawn ? split.second.camera : null);
    groundShade.update(cameraSystem.camera, !renderer.shadowMap.enabled, split.drawn ? split.second.camera : null);
    mark('street details');
    lightingSystem.update(cameraSystem.currentPos);
    // (the radar every other frame on the Xbox, where each redraw of it costs a few tenths of a millisecond)
    radarTick = !radarTick;
    mapSystem.setPursuer?.(trafficSystem.pursuer?.());
    if (!XBOX || radarTick || mapSystem.isFullMapOpen) mapSystem.update();
    placeChampionSign();
    // (by the clock, as the weather is: a frame of play counts at most 0.05 s, and none while the page was hidden)
    if (lightingSystem.activePresetId === 'now' && Date.now() - nowCheckedAt > 60e3) {
      nowCheckedAt = Date.now();
      selectTime('now');
    }
    if (Date.now() - weatherAskedAt > 15 * 60e3) askWeather();
    precipitation.update(cameraSystem.camera, elapsed);
    fallingLeaves.update(cameraSystem.camera, elapsed);
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.lookId === 'midnight');
    outdoors.update(dt, elapsed, cameraSystem.camera);
    {
      const car = controllerManager.entities.car;
      const driving = controllerManager.activeMode === 'car' && car;
      audioSystem.tireSkid(driving ? car.skid || 0 : 0, driving ? Math.abs(car.speed) : 0);
      // the road under the wheels: brick, gravel, planks, wet roads' hiss, and the bicycle's gear changes
      audioSystem.ride(controllerManager.getActiveEntity(), controllerManager.activeMode);
    }
    mark('light, map, weather, sound');
    // on the Xbox, short of processor, the culling runs every third frame and the ground's streaming every fourth (each
    // at once after a jump of the camera, and the culling every frame of a split screen, which culls twice a frame)
    const camAt = cameraSystem.camera.position;
    const leapt = Math.abs(camAt.x - lastChecked.x) + Math.abs(camAt.z - lastChecked.z) > 40;
    checkTick++;
    // the full map, once faded in, covers the whole view: the city isn't drawn under it (nor culled for drawing),
    // which gives the map's own drawing the frame; the canvas keeps the last picture, and closing it draws again
    const mapCovers = warmedUp && mapSystem.isFullMapOpen && mapOpenedAt != null && performance.now() - mapOpenedAt > 300 && !videoRecorder.recording;
    // the warm-up frame draws every chunk (below); a first frame without one culls as every later frame does
    const warmupFrame = !warmedUp && !warmStart && QUALITY.shadows && !XBOX;
    if (!warmupFrame && !mapCovers && (!warmedUp || !XBOX || split.drawn || wasSplit || leapt || checkTick % 3 === 0)) {
      updateSceneCulling(camAt);
      lastChecked.copy(camAt);
    }
    wasSplit = split.drawn;
    if (warmedUp && TIER.warmReach) warmAhead(elapsed);
    // (the tiles wanted looked for every fourth frame on every device and in split screen: a player covers a few metres
    // in four frames against 500 m tiles, and each look walks every tile of the town; at once after a leap)
    if (TIER.stream && (!warmedUp || leapt || checkTick % 4 === 1)) {
      const { x, z } = cameraSystem.camera.position;
      const two = split.drawn ? split.second.camera.position : null;
      updateGroundStreaming(x, z, two?.x, two?.z);
      houseStream?.update(x, z, two?.x, two?.z);
    } else if (TIER.stream) putStreamedGround(); // (the tiles waiting go in one a frame, between the Xbox's scans)
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
    if (!warmedUp && !warmStart && QUALITY.shadows && !XBOX) {
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
    // the far shaders compiled during play (compileLater) leave the renderer drawing into the scene pass's target
    // between their steps, which would keep every frame off the screen: each frame starts from the screen
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    gpuTime.begin();
    if (mapCovers) {
      // (nothing drawn: see mapCovers)
    } else if (split.drawn && warmedUp) {
      // each half with what's near its own camera shown, the far chunks hidden from it (scene-culling.js), and its own
      // rain or snow, murk under the river, airport and livery; the first player's come back with the next frame
      const cam2 = split.second.camera;
      split.view.render([
        { scene, camera: cameraSystem.camera },
        { scene, camera: cam2, before: () => {
          updateSceneCulling(cam2.position);
          moonPart.made.update(cam2);
          starsPart.made.update(cam2, starsAt(cam2));
          precipitation.update(cam2, elapsed);
          if (lightingSystem.uUnder) lightingSystem.uUnder.value = underAt(cam2.position);
          airportPart.made.update?.(0, cam2.position);
          liveryPart.made.update(0, elapsed, cam2.position, null);
        } }
      ]);
      moonPart.made.update(cameraSystem.camera);
      starsPart.made.update(cameraSystem.camera, starsAt(cameraSystem.camera));
    } else renderPipeline.render();
    gpuTime.end();
    mark('render');
    prof.n++;
    prof.draws += renderer.info.render.drawCalls;
    prof.tris += renderer.info.render.triangles;
    {
      let t = 0;
      for (const v of prof.cur.values()) t += v;
      if (t > prof.worst) {
        prof.worst = t;
        prof.worstLine = [...prof.cur].filter(([, v]) => v >= 2).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
      }
      if (warmedUp) watchWork(t, rawDt);
    }
    if (elapsed >= prof.next && warmedUp) {
      prof.next = elapsed + 10;
      const parts = [...prof.parts].map(([k, v]) => `${k} ${(v / prof.n).toFixed(1)}`).join(', ');
      let logic = 0;
      for (const [k, v] of prof.parts) if (k !== 'render') logic += v / prof.n;
      const gpu = gpuTime.take();
      log(`[frame] ms a frame: ${parts}; logic ${logic.toFixed(1)}, render ${((prof.parts.get('render') || 0) / prof.n).toFixed(1)}, GPU ${gpu == null ? 'n/a' : gpu.toFixed(1)}; ${Math.round(prof.draws / prof.n)} draws, ${(prof.tris / prof.n / 1e6).toFixed(2)}M triangles; slowest ${prof.worst.toFixed(0)} (${prof.worstLine})`);
      prof.worst = 0;
      prof.lastDraws = prof.draws / prof.n;
      prof.parts.clear(); prof.n = prof.draws = prof.tris = 0;
      // once a run, what the camera has in front of it, part by part (triangle-report.js)
      // (and on the Xbox again whenever a view draws a lot, at most once a minute, to see what's behind it)
      const many = XBOX && prof.lastDraws > 350 && elapsed >= (prof.reportAgain || 0);
      if (!prof.measured || many) {
        prof.reportAgain = elapsed + 60;
        if (!prof.measured && renderer.userData.deviceLine) log(renderer.userData.deviceLine + ' (as found when the page opened)');
        prof.measured = true;
        showTriangles.frame = `${parts}; ${renderer.info.render.drawCalls} draws`;
        // (the shadow cascades' walks only while shadows are drawn)
        showTriangles(reportTriangles(scene, cameraSystem.camera, renderer.shadowMap.enabled ? lightingSystem.sunLight.shadow : null));
      }
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
        // every kind of car ready to get into, compiled a few seconds into play (compileLater)
        compileLater([controllerManager.carsToPrepare()], { detached: true, what: 'cars to get into' });
        // and the squirrels' and the deer's skinned bodies (animals.js; none on the Xbox)
        if (!XBOX && animalsPart.made?.toPrepare) compileLater([animalsPart.made.toPrepare()], { detached: true, what: 'animals' });
        audioSystem.ready = true;
        // Lamp: the Mac app lets the page play sound unasked, so the city is heard as it appears, not at the first key
        audioSystem.unlock();
        setLoadingProgress(1);
        // the town painted from above for the far ground (outskirts.js), once the city's on screen
        if (QUALITY.outskirts) setTimeout(() => paintTown({ blocks: cityBlocks.allBlocks, canopy: streetDetails.canopy }), 1000);
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
      // (written only when it moves by a pixel's worth: each new value is a style to work out again)
      if (elSpeedMeter && dialScale.max) {
        const fill = Math.round(Math.min(1, mphExact / dialScale.max) * 200) / 200;
        if (fill !== hud.shownFill) { hud.shownFill = fill; elSpeedMeter.style.transform = `scaleX(${fill})`; }
      }
      // the street's speed limit beside it, in the car or on the bike, looked up four times a second
      if (elLimit && hud.clock - (hud.limitAt || 0) >= 0.25) {
        hud.limitAt = hud.clock;
        const p = ent.position, road = (dialMode === 'car' || dialMode === 'cyclist');
        let limit = road ? speedLimitAt(p.x, p.z, ent.heading) : 0;
        // kept a couple of seconds off the street (cutting a corner, a lawn, a lot) so the sign doesn't blink
        if (limit) hud.limitSeen = hud.clock;
        else if (road && hud.shownLimit && hud.clock - (hud.limitSeen || 0) < 2.5) limit = hud.shownLimit;
        if (limit !== hud.shownLimit) {
          hud.shownLimit = limit;
          elLimit.hidden = !limit;
          if (limit) elLimitMph.textContent = String(limit);
        }
        elLimit.classList.toggle('over', !!limit && mphExact > limit + 10);
      }
      if (split.drawn) split.second.drawHud(topSpeedMph[split.second.cm.activeMode]);
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
      const getIn = getInNow();
      if (jumping !== jumpOut || getIn !== getInWords) {
        jumpOut = jumping;
        getInWords = getIn;
        renderControlHints(mode);
        touchControls.setGetOutWords(mode === 'person' ? getIn || 'Get in' : jumping ? 'Jump out' : 'Get out');
      }
      buildDial(mode, activeEnt.drive);
      if (elAltitude) elAltitude.textContent = altFt.toLocaleString('en-US');
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      updateChampion(now, where);
      if (arrival && Math.hypot(where.x - arrival.x, where.z - arrival.z) > 25) arrival = null;
      renderLocation(getLocationLabel(where.x, where.z, arrival?.id), busLine());
      // (no notice coming onto the Border to Border Trail: the place name up top already says so)
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
             map: mapSystem.isFullMapOpen, hudHidden: document.body.classList.contains('hud-minimized'),
             split: { on: split.on, offered: split.offered, second: split.second?.snapshot() ?? null }, golf: golf.snapshot() };
  }
  function startFrom(state) {
    if (state?.version !== 2) return;
    for (const mode of Object.keys(controllerManager.entities)) {
      const p = state.entities?.[mode];
      if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
      restorePlace(mode, p);
      if (Number.isFinite(p.speed)) controllerManager.entities[mode].speed = p.speed;
    }
    selectMode(Object.hasOwn(controllerManager.entities, state.activeMode) ? state.activeMode : controllerManager.activeMode);
    if (state.time) selectTime(state.time);
    if (state.camera) selectCamera(state.camera, true);
    if (Number.isFinite(state.zoom)) cameraSystem.zoomMultiplier = state.zoom;
    if (typeof state.hudHidden === 'boolean') hudChosen = true;
    if (typeof state.hudHidden === 'boolean' && hudToggleBtn && state.hudHidden !== document.body.classList.contains('hud-minimized')) hudToggleBtn.click();
    if (state.map === true) mapSystem.toggleFullMap(true);
    // split screen as it was: the second player where they were, drawn again once the frame sees both controllers
    if (state.golf && controllerManager.activeMode === 'person') golf.restore(state.golf);
    if (state.split) { split.on = state.split.on === true; split.offered = state.split.offered === true; split.kept = state.split.second; }
  }

  // sharp: drawing smaller never made frames faster here (the log showed it undone every time), it only blurred the city
  // fill: drawn at the window's shape everywhere but the Xbox (stage.js), which keeps the fixed 1920x1080 stage
  let stopFilling = null;
  game({ renderer, init() {
    // the Xbox: Lamp's stage at 1920x1080 (scale 1); elsewhere the window's shape at the tier's pixels
    stopFilling?.();
    stopFilling = fillWindow(renderer, (w, h) => { stage = { w, h }; fitCameras(); });
    const was = pendingRestore(); if (was) startFrom(was); else golf.resume(); // (a golf round saved at the last close)
  // (on an Xbox too: the runtime's own steps, from 1920x1080, undid its smaller size and left it at 960x540 or full size)
  }, frame, touch: false, keyboard: false, snapshot, sharp: XBOX || TIER.name !== 'phone', fill: FILLS,
    // What this run made that no part keeps goes with it: the map and the camera system are made afresh by the next.
    dispose() { stopFilling?.(); golf.dispose(); groundShade.group.removeFromParent(); groundShade.dispose(); split.second?.dispose(); split.view?.dispose(); document.body.classList.remove('split');
      cameraSystem.release(); mapSystem.release(); renderPipeline.dispose(); colorGrade.dispose(); ssrPass?.dispose(); aoPass?.dispose(); scenePass.dispose(); } });
  container.appendChild(renderer.domElement);
}

// A start that fails (a builder's error, a file that didn't come) says so where the loading screen says what it's
// doing, rather than leaving its bar sweeping for good; what went wrong goes to the log
initApp().catch((e) => {
  log(`[init] the city couldn't be built: ${e?.stack || e}`);
  console.error(e);
  const overlay = document.getElementById('loading-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  const track = overlay.querySelector('.loader-track');
  if (track) track.style.visibility = 'hidden';
  const status = document.getElementById('loading-status');
  if (status) status.textContent = 'The city couldn\'t load. Close Go To Ann Arbor and open it again.';
});
