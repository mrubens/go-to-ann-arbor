Kind: game, drawn with three.js (Lamp's runtime in Web/lamp-game.js), at home on the Mac.
Flow: open Map, search mapped businesses, landmarks or streets, then choose a result to start driving directions without teleporting. Close Map to follow the HUD and gold road ribbon; reopen to change or clear the destination. Directions resume after code changes and launches.
Flow: resume exploring directly; driving swaps the dashboard by powertrain. A parked EV offers charging in its dashboard; accelerating disconnects. Existing travel, map and return flow stays the same.
EV pedal feel: electric launch acceleration is 25% stronger, and the Wedge Truck is 70% stronger with torque held farther into the speed range. Releasing the accelerator immediately applies 4.2 m/s² regenerative braking through to a stop. The dashboard has a center-zero power meter: mint regeneration to the left, amber motor output to the right, with a signed normalized output percentage (not measured kW). Output follows the torque curve; airborne wheels show zero. Cached handling refreshes through tuningVersion 2.
Electric cars: Tesla, Ioniq, Cybertruck and Rivian use a mint digital speed, D/R/P, battery percentage, approximate range, power/regen status and Park & charge button. Gas cars retain the analog gear/RPM dial. EVs have instant low-speed torque, a single-speed power curve and stronger regenerative coast braking. T or controller D-pad down connects/disconnects a game-style fast charger anywhere stopped (about a minute to full; slower above 80%). Driving consumes charge, braking recovers a smaller amount, and zero charge removes propulsion. `powertrain.js` registers batteries by vehicle ID with the runtime and saves them; parked swaps retain IDs. The EV whine is synthesized through runtime sound because pitch follows speed and load, without combustion or shifts; charging uses Kenney's confirmation sound. Existing sound toggle silences both. No playtest requested.
Look: EV dashboard is a mint-on-charcoal digital panel in the existing bottom-right cluster, with a battery bar; ICE keeps its round orange-needle dial.
Look: a sunlit 3D Ann Arbor, Michigan at true scale (brick downtown, campus limestone, leafy neighborhoods, the Huron
River, Michigan maize #FFCB05 and blue #00274C on the Big House), with a translucent dark heads-up display over it: the
place and street at the bottom left over a minimap, the modes (Walk, Drive, Cycle, Fly, Paddle) at the bottom, the vehicle and
its speed at the bottom right as a round analog dial (bezel, ticks, numbers and an orange needle, redline on the car and helicopter; `buildDial` in main.js draws the scale for each mode, `#dial` in index.html and `.dial` in style.css), and time of day, Teleport, Map and sound at the top right.

# Ann Arbor

Slop Ann Arbor: Mr.doob's Slop New York (MIT, `Web/LICENSE-slop-newyork`, commit e35c06c in credits.json; its changes since 13dd142 merged in: road paint in culled chunks, crowd culling and a vertex-shaded far LOD for people, cell-by-cell tree LOD, fire escapes, storefronts and entrances, building collision, gamepad and car wheel material) moved from
Manhattan to Ann Arbor. The city inside the I-94/US-23/M-14 ring, about 7 by 6 km, with every street where it really
is, every building from the city's surveyed footprints and heights, the Huron River, parks, the Diag, street trees from
the city's inventory, traffic and people; Michigan Stadium ("the Big House") modelled by hand.

- **Getting around**: 1 walk, 2 drive your own black compact SUV (a Subaru Forester look, Michigan "GO BLU" plates; Ann Arbor has few taxis), 3 cycle, 4 fly a sightseeing helicopter, 5 paddle a kayak on the Huron (its current follows the river's real flow, below, carries it and turns it where the bow and stern feel different currents; only a blade in the water drives it, each stroke a surge, where a blade goes in and out the water's own surface ripples in rings, and a V wake runs off the bow, both tilting the water's shading, no overlays (`waterDisturb` in tsl-materials.js, set by `updateKayak`, `kayakRipple`, `updateRipples` in controllers.js); the HUD shows its speed over the bed; the Argo Cascades beside Argo Dam are paddleable: nine one-foot drops between rock weirs, from OpenStreetMap's channel and weirs (cascades.js: the water steps down weir by weir in `waterLevel`, the rocks block all but each chute, the current quickens through it, white water below tosses the kayak and it noses down each drop; the rapids are drawn in the water's own shader (`rapidsField` in tsl-materials.js: standing waves, chop and foam), the pond side of the dam is held at the pond's level behind a low wall (`DAM`, `pondSide`), the pond draws the kayak gently to the channel's head (`pondDraw`), and river.js cuts the water and banks every 3 m around the channel while leaving out dry land; the ground under the town (outskirts.js) takes the lowest ground around there so it never shows through). Kayakers and tubers float down from the cascades on a traced 2.4 km run, respawning at the top (river-people.js). F gets out of a car and into the nearest one, parked or moving (the moving one's driver is left behind; `enterOrExit` in controllers.js), and getting out of anything still moving is a jump (`bailOut` in controllers.js): out of a car above about 9 mph the player is thrown limp at the car's speed and the empty car rolls on to a stop or a wall; out of the helicopter in the air they drop, or from over 7 m skydive belly-down, spread-eagled (`skydive` in pedestrians.js; left and right turn, forward tracks: arms swept back, head-down, up to 30 m/s ahead while falling slower, back drifts backwards; the get-out hint says Jump out whenever getting out is a jump, `exitJump`), (the helicopter flies up to 200 mph, `maxHorizSpeed` in `updateHelicopter`, and climbs to 1,500 m, `HELI_CEILING`, faster above 250 m) until they pull a maize-and-blue parachute with the jump button, pressed afresh (`parachute`, `updateChute`: the camera falls back and looks up to take in the canopy; forward and back speed or slow the glide, left and right turn; never pulled, they splat and lie still a few seconds, `fallen.wait`) while the empty helicopter sinks to the ground (`coastEmpty`). The walking camera's framing is `WALK_CAMERA` in controllers.js (eased back after a fall, higher and looking down while the player is down). On foot inside Michigan Stadium's wall the player walks its field and stands (`carSurface`), kept in by the wall. Each car kind drives its own way (`CAR_HANDLING` in controllers.js: mass, top speed, pickup, grip, steering, body roll; optional `lock`, the widest steering angle, and `yaw`, how fast it turns in: the sport bike turns on a dime); traffic and parking include a low sports coupe (`BODY_SPECS.sports` in cars.js), the quickest to drive. Parked cars keep their lamps dark. Car crashes are rigid-body impulses: into walls and posts at the corner or face that touched, with bounce, sliding friction and spin (`carWallImpulse` in controllers.js); into traffic by mass (vehicle-physics.js); into parked cars, which are bodies of their own weight, shoved and spun, sliding to a stop on locked wheels and knocking the cars beside them (`shoveParked`/`settleParked` in controllers.js, `step` in parked-cars.js). On the bike, the map and minimap show bike lanes solid, shared lanes dashed and paved paths thin (city-map.js). W A S D or the
  arrows, Space or E up and Q or C down in the helicopter, Space (A, a touch button) the car's handbrake (locks the back
  wheels: scrubs speed, lets the tail slide), B horn. Dragging orbits the camera. Each way of getting around starts
  at its own view (`SCENIC_STARTS` in main.js): walking on the Diag facing Burton Tower, the car on Main St at
  William (a first play starts there), the bike in South University's bike lane, the helicopter high south of the
  stadium facing downtown, the kayak in the Argo Cascades' channel by Argo Park's dock, facing the rapids. 1 to 5 (`travelBy`) take the player there,
  unless that vehicle is within 40 m, when they just take it. The helicopter lands wherever its skids come down: the ground, Michigan Stadium's field
  and stands (it flies into the bowl; `helicopterFloor` in `controllers.js` uses `bowlSurface`), and any roof it
  was above: a house's own pitched roofs (houses.js gives the house's collider `roofs`, each a plane set), other
  buildings' flat tops. A roof it rests on doesn't push it sideways; one above it is still a wall.
- **Cameras**: V (Shift-V back): chase, action, first person and scenic ones (`diag`, `mainStreet`, `stateLiberty`,
  `burtonTower`, `burtonTop`, `bigHouse`, `arbRiver` in `cameras.js`).
- **Knocks and falls**: people, trees, signal and lamp poles and sign posts are solid (`obstacles` from
  street-details.js and traffic-controls.js, colliders marked `thin` so the helicopter ignores them). A person the
  player hits at speed goes limp: a 16-point Verlet ragdoll (`startRagdoll`, `stepRagdoll`, `solveRagdoll` in
  pedestrians.js, driven by `strike` in pedestrian-system.js), who always gets back up a few seconds after coming to rest, through the dive's recovery, and steps back to their way
  (nobody stays down; one flung far off out of sight just goes home). A cyclist hitting something hard, or the player struck by a car, falls the same way
  (`knockDown`, `throwRider` in controllers.js), then stands up; a 'thud' cue and rumble go with each hit.
  A car hitting a tree, pole or sign post hard enough knocks it over (knockdowns.js): the speed it takes grows with
  a tree's trunk and falls with the car's mass; it tips about its foot the way the car went, lands with a thud or
  crash, stays down and stops being solid, and the car loses speed by how stout it was. A felled streetlight goes dark (its
  light sites get `out`, its pool is hidden); scene-culling.js notes where each split-up instance went (`movedTo`,
  `shadowCopy`) so a knocked-over piece moves where it's drawn (a chunk never inherits
  its source's notes). The parks' globe lampposts (`parkLampMeshes` from city-grid.js) are solid and fall the same way.
  Fire hydrants (obstacles of kind 'hydrant' from street-details.js) are thrown instead: they fly off tumbling the way
  the car went, bounce and scrape to rest (`throwHydrant`, `updateFlying` in knockdowns.js), and the broken riser gushes
  (hydrant-spray.js): a clear, streaming jet leaning with the breeze (a flared open cylinder with TSL streaks), thin
  speed-streaked drops falling back as rain with splashes, soft camera-facing mist puffs, and a spreading wet patch;
  full pressure 30 s, then shut off over 6 s. Its roar is `gush` in audio-system.js.
  Cars drive into the Big House over its rim: `carSurface` in stadium-shape.js is the car's ground there (the wall
  top, the concourse, then the stands' steps down to the field), and the bowl's colliders don't stop cars. Cars leave
  the ground when they come over a crest or up the stands fast (`carVertical` in controllers.js: ballistic flight,
  nose following the arc, a thump and rumble on landing); a step up too tall for the speed bounces them back.
  A jump can land the car on a building: `carRoof` makes the roofs under it its ground (kept in `_carStanding` so
  they aren't walls), and it drops off the edge at any speed. Sliding back tires (`car.skid`, from the handbrake or
  the tail stepping out) lay fading rubber streaks and white tire smoke (skid-effects.js). The player's own car is a
  maize sports car with GO BLU plates (OWN_CAR). The field has its yard numbers and goal arrows (landmarks.js).
- **Two wheels and boards** (motorcycles.js): sport bikes, cruisers, scooters, tourers and adventure bikes, plus
  bicycles, e-bikes (about one in sixteen of traffic, the commonest curb rider: traffic.js gives every twentieth slot to one besides the curb riders' turn; battery on the down tube, rear hub motor, fenders and rack; ridden to 28 mph), e-scooters and hoverboards, each a procedural model of smooth lofted shells (`loftGeometry`), real
  wheels (cast, wire or disc, with rotors), one mesh per kind for traffic. Riders are the town's skinned people
  (`PersonRig.perch` in pedestrians.js, posed from `motoRiderPose(kind)`, drawn through a `PersonCrowd` in traffic.js
  within RIDER_DISTANCE) wearing a real helmet (`buildHelmetGeometry`, full, open-face or bicycle by `HELMET_OF`). Motorbikes ride in lanes
  (1 in 10 of traffic); the quiet kinds (`quiet`, 1 in 10) keep to the curb side of the lane (`CURB_OFFSET`) at
  their own pace (`curbSpeed`), and cars pass them rather than queue (`ahead` in traffic.js). Any of them can be
  taken from traffic and ridden in car mode (`createBikeEntity`, handling in CAR_HANDLING); the player rides as their own
  person perched on it with the bike's helmet (`riderPose`, `riderMesh` is the helmet), so a crash over MOTO_THROW_SPEED into a wall or car throws them off (`throwMotoRider`).
  A big jump switches to a cinematic camera until landing (cameras.js), higher in the stadium.
- **Road work** (road-work.js): Michigan's closed blocks with cones, drums, barricades and detailed dump trucks
  and excavators; traffic routes around closed blocks, and anything driving into the cones knocks them aside.
  The dirt (piles, the truck's load, the bucket's scoop, the dug patch) is lumpy procedural mounds (`moundGeo`, `clods`)
  drawn with ambientCG's Ground 054 soil photo, projected from the world and tinted by vertex colour (`soil` attribute);
  the machines wear mud low down, streaks, dust on top and shade underneath, all in the one road-work material.
  The machines are drivable: `nearestMachine` feeds getting in (controllers' enterOrExit), `take` hides the parked one
  and `leave` puts it down where you got out, `claim` restores one held in a save, `home` (Reset) puts all back.
  The player's machine is built by `createMachineEntity` (six truck wheels, the front pair steering; the excavator
  slides on its tracks) with CAR_HANDLING's `dumptruck`/`excavator`, a bigger collision box (`MACHINE_BOX` → `playerBox`,
  also read by traffic and train contact) and the bus engine sound.
- **The city**: time of day from the buttons at the top, Teleport (every landmark: Main Street, the Diag, Burton Tower, the Michigan
  Theater, Kerrytown, the Big House, the Arb, Gallup Park, the Cascades, Hill, the Union, UMMA, the library, Crisler, Amtrak, the Gandy Dancer, Graffiti Alley, the League, Rackham, Yost, the Farmers Market, Tower Plaza, Huron High, Ann Arbor Airport (outside the city, its apron by the FBO); and places in the outer neighborhoods, not modelled landmarks, their buildings the city's survey: Briarwood, Pioneer High, Arbor Hills, Buhr Park, County Farm Park, Leslie Park, Skyline High, Veterans Memorial Park), M the full map (the city limits dashed) (true north up), H hides the HUD, N sound, and the reset button (after sound) puts the car, bike, kayak, helicopter and walker back at their starts (`resetGame` in `main.js`).
- **A controller** works too (`gamepad-controls.js`): left stick move or steer, right stick look, RT and LT gas and
  brake, A jump, LB and RB change mode, Y the camera, Menu the map and B closes it.
- The guide to the controls and the keys on the HUD's buttons show what the player is holding (`input()`, `label()`
  and `glyph()` from lamp-game.js, in `controlHints`, `renderControlHints` and `relabelKeys` in main.js).
- The game remembers where the player was between launches (`save('player')`, version 2 since the move from New York).
- **Badge and map**: the top left says "Go To Ann Arbor" and "GitHub ↗", which opens https://github.com/mrubens/go-to-ann-arbor
  (through `openRepo` in Sources/Native.swift in the app; a plain link elsewhere). Mr.doob's credit is in the app's
  About window and info (credits.json), not on the map (the person didn't want it there). Map search offers bundled business signs, landmarks and streets; choosing a result or clicking the map starts directions, while Teleport remains separate. Clear route or the directions panel's close button ends guidance.
- **Driving directions** (`navigation.js`): Dijkstra over the traffic system's directed road network, respecting one-way lanes, permitted turns and construction closures. Routes sample lane-to-lane intersection curves, draw gold lines on both maps and one buffered gold ribbon on the road, and show upcoming turns, feet/miles to the turn, destination and distance remaining. Off-route or wrong-way driving recalculates at most every three seconds. Buildings are reached at the nearest connected road, with an explicit nearby message when the endpoint is off-road. Search uses the city's bundled place data, not a live business directory. The selected destination is registered with hot state and saved between launches; routes are derived again from the player's retained position. Guidance updates at 0.15-second intervals; the ribbon is one draw with a fixed buffer. No playtest requested.
- **Churches**: a sizeable building on a religious parcel is drawn by churches.js (gable roof, bell tower and spire
  with a cross, lancet and rose windows, a door), 55 of them.

## Code

- The page is `Web/`: `index.html` the page and the HUD's markup, `css/style.css` the HUD's look. Lamp's files beside
  it are `lamp-game.js` (the runtime: the frame, the pads, saves), `lamp.js` and `three/` (three.js with its WebGPU
  renderer and node materials, `three/webgpu` and `three/tsl`, drawing with WebGL 2), loaded through the import map.
- `Web/js`, all ES modules:
  - `main.js`: start-up, `QUALITY` (what's drawn), the HUD, keys, and `frame(f)`, which Lamp's runtime calls about 60
    times a second (`game({ renderer, init, frame, touch: false, keyboard: false, snapshot })`: the city reads its own
    keys and draws its own touch controls; a controller comes as the first pad; after a change of code `init` starts
    the city where `snapshot()` left it, full map and hidden HUD included). Lamp draws it at 1920x1080 and fits that to the window.
  - The place: `city-geodata.js` (the real geography, generated data: don't edit by hand), `city-config.js` (streets,
    parks, water, the town's edge `TOWN_EDGE` and bounds `TOWN_BOUNDS`, `LANDMARKS`, in meters), `city-grid.js`, `landmarks.js`, `outskirts.js`, `road-network.js`,
    `road-paint.js`, `traffic-controls.js` (traffic lights on mast arms at OSM signals, switched each frame from
    city-config.js's signalPhase so they match what traffic obeys; stop & yield signs where road-network.js put
    them, mapped or inferred at side streets), `street-details.js` (lamps, signs, hydrants, tree pits), `street-props.js`, `trees.js` and
    `tree-placements.js`.
  - Buildings: `building-geodata.js` reads every surveyed building from `building-geodata.bin.gz` and
    `tree-geodata.js` every street tree from `tree-geodata.bin.gz` (both beside them, generated by Mr.doob's
    `tools/build-buildings.py` and `tools/build-trees.py`). `buildings.js` makes them
    into merged facades (`building-footprints.js`, one mesh per square kilometer) with their details
    (`building-details.js`, `fire-escapes.js`), colliders the shape of each outline (`building-collision.js`).
  - Looks: `tsl-materials.js` (every material, in TSL), `lighting.js` (`TIME_PRESETS`: sun, sky, fog for each time
    of day), `post-processing.js` (glow and color grading), `vehicle-lights.js`.
  - Things that move: `controllers.js` (the four ways to move, their physics and keys), `traffic.js` (cars and buses),
    `vehicle-physics.js` (how vehicles hit and push each other), `pedestrian-system.js` (the people around the player,
    how they cross and dodge), `pedestrians.js` (their bodies and gait) and `pedestrian-routes.js`; the vehicles are
    lofted from cross-sections in code with three.js's LoftGeometry: `cars.js`, `bus.js`, `helicopter.js`, and the
    pieces they share in `vehicles.js`.
  - `cameras.js`, `city-map.js` (the minimap and the full map), `scene-culling.js`, `audio-*.js` (the synthesized
    sounds), `gamepad-controls.js`, `touch-controls.js` (shown on a touch screen: the stick and round action buttons drawn as pictures only, no words: jump, handbrake, ascend, descend, get in, get out, jump out, symbols i-jump… in index.html's sprite, swapped by TOUCH_ICONS; the mode switch and the camera and radio rows give way to one bar at the bottom (#compact-bar: how you travel, the view, the music), each button opening its list (#mode-popover, the camera popover, #radio-popover filled by radio.js), placed by main.js's popover code under its button (a Mac window narrower than 820 px gets the same bar, a small speedometer pinned in the bottom-right corner, the map's height, with the bar layered over both; both go below 620 px); a touch screen opens in clean view, the eye closed, unless a kept snapshot says otherwise).
  - The ground: `terrain.js`. The city is built flat at street level (y = 0) and then set on the real ground's heights:
    `groundHeight(x, z)` is the one answer to "how high is the ground here", and everything asks it. `setOnTerrain`
    (called in main.js once the city is built) cuts the ground layers finer where the ground bends and lays them on
    it, and lifts whatever stands on it whole; buildings and churches stand on the highest ground
    under their outline, so no door is buried uphill, and houses on the mean ground under it, the uphill lawn reaching
    at most 70 cm up the wall (`UPHILL`), and on a steep bank the floor at most 80 cm over the lowest lawn
    (`DOWNHILL`), the uphill side dug in up to 1.5 m (`BANKED`), so the 1 m survey's real banks don't stand every house on a flight of steps, with their walls and foundations reaching down past the lowest
    (`minGround`; Ken MacInnis's pull request #2: houses.js steps and stoops follow the lawn down, the facade shader
    leaves the foundation below floor 0 plain; `buildings.js` lifts their colliders, details and billboards with them) and landmarks under their lot
    (`groundUnder`), and the facade shader counts storeys from there (the `ground` attribute of `createFacadeBoxes` and
    `createBuildingFootprints`).
    The cutting is the slowest part of a start, so it's done once and saved: the height maths and the cut itself are
    plain functions in `ground-core.js`, run on several cores by `drape-worker.js` (each long triangle halved to 200 m
    first, so the one road quad over the town is shared out too); the draped layers, already in 800 m tiles, are saved
    in IndexedDB (a database per city part, `ground-layers-<part>`), keyed by a fingerprint of the heights, river,
    bridges, the cutting code and each layer's own geometry, and read back on later starts. setOnTerrain answers a
    promise when it has layers to cut; main.js awaits it in the grid and street-details parts. Under the city the
    ground is one mesh of right triangles (RTIN, `ground-core.js`) over `data/ground.bin.gz`, a 4 m grid within 10 cm
    (25 cm in its smallest triangles), and every flat layer (road, sidewalks, lawns, driveways, paint) is cut along
    those same triangles, so each is the ground plus a fixed lift and none can cross another. The lifts are real
    heights (`ground-lifts.js`: paint 5 mm, curb 15 cm, slab 16 cm, lawn 18 cm). Driveways and front walks are drawn
    in front of the lawn with `drawOver` (terrain.js: each vertex pulled along its line of sight, so only its depth
    changes) only so they don't flicker far off. Streets are graded level across their width at their centerline
    height, the 5 m of sidewalk beside them level too (`WALK`), with a short bank to the ground behind it, by build-ground.py; a street's ends are pinned to the
    surveyed height at each crossing. The layers' normals and colours are packed to bytes, so the finer cut costs no
    more memory than the old one. Driveway aprons (small, four
    corners) are always concrete, so the sidewalk never shows a blacktop patch. Pavings with holes (the walk webs of the Diag and the quads) are
    concrete too; only wide paved yards are always blacktop. The map's footpaths (golf.js `buildTrails`) are the same concrete and draw over the lawn but
    under that paving (`drawOver` 3 cm vs 6 cm), since they run a little off the surveyed walks. The preview has no lasting
    database, so it always cuts. Start times (the open game, cold → saved): street level ~11.5 s → 3.7 s → 2.7 s.
    Cars, bikes, people, the helicopter's skids and the cameras follow it each frame; cars tilt with the slope
    (`groundTilt`). Something new that stands on the street: build it at y = 0 as before, and add
    `groundHeight(x, z)` where it's placed (or leave it in a group setOnTerrain sets).

- Live Ann Arbor (each answers only in the app around the page, through Native.swift's `feed` for hosts that don't let
  a page ask; the preview uses saved samples or the timetable): `live-feeds.js` (that bridge, a GTFS-realtime reader,
  `toWorld(lat, lon)`); TheRide's real bus positions shift each trip's timetable by its live delay (`theride.js`
  `applyLive`, polled every 30 s in `traffic.js`); U-M's Blue Buses run from U-M's GTFS timetable (`data/umbus.json.gz`,
  navy and maize in `bus.js`; their live tracker needs a key, so no live positions); `city-closures.js` (the city's
  Downtown Street Closures layer on today, plus MDOT MiDrive's Washtenaw total closures) feeds `road-work.js`, whose
  invented closures are only the fallback; `planes.js` (OpenSky aircraft, every 60 s, the free API's allowance; drawn through the haze, cruisers above 7.5 km with contrails, altitudes less the town's 270 m; made-up flights fill the sky while fewer than three real ones are within 25 km: DTW arrivals and departures, cruisers, small planes in and out of ARB); `scooters.js` (Bird/Spin GBFS,
  every 2 min; Lime has no Ann Arbor feed); `snow-cover.js` (Open-Meteo snow depth whitens what faces up, through
  `cityUniforms.uSnow`; a material's `userData.snow` sets its share: 0 for water and leaves, 0.18 for plowed roads);
  `moon.js` (the moon disc in its real phase, where the night light comes from). Fall colors (`trees.js` `fallOf`)
  turn by species and date. Downtown parking has no public live feed.

- three.js is Lamp's (`Web/three`), older than the one Mr.doob now pins: the tree and sign materials keep
  alpha-test nodes (`alphaTestNode`/`maskShadowNode`) rather than `alphaTest`, the workaround he dropped in his commit
  c9c1900 once three.js fixed shadow casters re-checking their shaders every frame.

## How the world is made, and growing or moving it

The whole City of Ann Arbor inside its official limits (75.6 km², x -4222..5901, z -4889..6330) is built offline, in
this order, all with `.lamp/reference/venv/bin/python -I <tool> .` from the app folder:

1. `Assets/Tools/fetch-annarbor.py`: the city limits (`.lamp/reference/aa/limits/aa_city_boundary.geojson`, the city's
   "City Boundary" open data), then everything asked for by area over the limits plus about 600 m (its `BB`):
   OpenStreetMap through Overpass (streets, buildings, water, woods, parks, land use, parking, rail, golf, trees; shops
   and amenities; signals and signs; level crossings; roof shapes; fuel; bookcases) and the city's tree canopy. Each
   file remembers its box and is fetched again only when the box changes. The city's other layers (buildings, street
   trees, hydrants, land use, park amenities, streetlights, zoning, historic districts, addresses, parcels, speed
   limits, paving) are whole-city downloads in `.lamp/reference/aa/` already.
2. `Assets/Tools/fetch-3dep.py`: the USGS 1 m bare earth, in 1 km squares over `CX0..CZ1` (now -6000..7000 both ways).
3. `Assets/Tools/build-annarbor.py`: the map (`Web/js/city-geodata.js`, buildings, trees, river, 10 m elevation, curb
   cuts, woods, yards). The detailed area `LAND` is the limits with the township islands filled, buffered 120 m:
   everything is clipped to it, and `GEO.edge` is its outline (`TOWN_EDGE`, `inTown` in city-config.js, which keeps
   cars and teleports inside). `GEO.limits` (the real limits and islands) is drawn dashed on the map. `CORE` (the
   first map's box, downtown, campus, Kerrytown, the Old West Side, the Arb and the big parks) is in `GEO.core` and
   `inCore` for anything that wants to spend less outside it (nothing does yet). It ends by running
   `split-geodata.py`, which moves the heaviest layers into `Web/data/` squares streamed by distance.
4. `Assets/Tools/build-ground.py`: the fine ground (`ground.bin.gz`, a 6 m grid of 2049², corner `GX0, GZ0`
   -5304, -5424, 12.3 km a side), the 10 m heights remade from it, and the river's levels.
5. `.lamp/scripts/roof_hills.py . --fix` (roofs the survey kept as ground; copies before it in
   `.lamp/reference/*-before-roofs.bin.gz`), then the smaller builders: build-addresses, build-districts,
   build-street-furniture, build-theride, build-rail-crossings, build-roof-shapes, build-gas-stations.

Heights are metres above `BASE` 227.8 m (pinned so the river's, dams' and landmarks' heights in the code stay put);
the east end down the river lies lower, so heights go down to `LO` -30 m (the ELV2 header's last number; river levels
are signed). Outside `LAND` the outskirts (outskirts.js) are a plain 50 m grid of the real heights with fields and
woods, out 6 km.

To add more area: widen `CX0..CZ1` in fetch-3dep.py and fetch, change the area `LAND` is made from in
build-annarbor.py (the limits, or a polygon of your own) and the fetch box in fetch-annarbor.py,
build-street-furniture.py and build-theride.py, and move `GX0, GZ0` (and `STEP`/`N`, keeping N at 2049 for the
terrain mesh) in build-ground.py so its grid covers it; then run the steps above. The ground's squares and the
geodata's split follow the area by themselves. To move to another place altogether, the world frame (`LAT0, LON0` in
build-annarbor.py) moves with it, and every Ann Arbor source (the city's open data URLs and field names, the USGS
squares, the GTFS feeds for TheRide and the U-M buses, the weather station and river gauge) needs its local
equivalent; the hand-placed things (landmarks and their models, teleports in city-config.js and index.html, the
dams, the cascades, the stadium, camera spots, area labels on the map) are Ann Arbor's and are written in world
metres, so they'd all be replaced.

## Data

Everything ships with the game; the only things fetched while it runs are the live weather (`weather.js`: the National
Weather Service's latest observation at KARB, api.weather.gov, every 15 minutes; a fair day offline; no personal
details sent) and the Huron's flow (`river-gauge.js`: the USGS gauge "Huron River at Ann Arbor", site 04174500,
discharge in cubic feet a second, asked for with the weather; public domain; the kayak's current is scaled by
(cfs/500)^0.4 within 0.45 to 2.4, and runs at 1 offline). All the rest is generated by
`Assets/Tools/build-annarbor.py` (run with the venv's Python in `.lamp/reference/venv`; its downloads are cached in
`.lamp/reference/aa/`), which writes the files below in the same shapes Mr.doob's New York tools did:

- `Web/js/city-geodata.js` (Ann Arbor's map; `GEO.edge` the detailed area's outline): streets, blocks, parks, water and the land's outline from
  OpenStreetMap through the Overpass API (ODbL). World frame: 1 unit = 1 m, x east, z south, true north up
  (`GEO.frame.bearingDeg` 0), origin at Main St & Liberty St (42.27965, -83.74838).
- `Web/js/building-geodata.bin.gz`: the City of Ann Arbor's building footprints (AAGIS, from 2009 LiDAR, with average
  heights; https://ckan.a2gov.org/dataset/building-footprints), OSM heights where it has them.
- `Web/js/tree-geodata.bin.gz`: the City of Ann Arbor's street tree inventory. It states no license: fine to use here,
  but ask the city before publishing or sharing the game widely.
- `Web/data/elevation.bin.gz`, `ground.bin.gz` and `river.bin.gz`: made at build time only by
  `Assets/Tools/build-ground.py` from the USGS 3DEP 1 m bare-earth model (fetched by `Assets/Tools/fetch-3dep.py`,
  public domain), with the open Terrain Tiles beyond its cover; heights relative to the lowest ground in the box
  (downtown is about 28 m up, the river lowest). Run `build-ground.py <app folder>` again after changing the streets. Where the 1 m model kept a big roof as ground (Palmer's parking deck and plaza by Washtenaw, the hospital helipad deck, two Geddes-area roofs), `.lamp/scripts/roof_hills.py` (flags and fills building footprints) and `.lamp/scripts/level_box.py` (a smooth fill of a box from its edges) leveled it after the build; the copies from before are in `.lamp/reference/*-before-roofs.bin.gz`. Run them again after rerunning build-ground.py.

Houses (survey kind 1 under 14 m, and small sheds and garages) are drawn by `houses.js`, not the facade shaders. Each
footprint is split (rasterised at 0.5 m in its oriented box) into a main block, the largest rectangle, and up to three
wings; the main block's roof is OSM's `roof:shape` where mapped (`data/roof-shapes.json`), else chosen from shape and
age (a gable to the street on narrow lots, hipped foursquares, side gables with dormers on 1.5-storey houses); wings get
lower cross gables or lean-tos. Storeys come from the survey height (LiDAR average, reads low: under 4.6 m 1, under
6.6 m 1.5, under 10 m 2, else 3). Roofs overhang with fascia, soffits and rake boards. Walls are one shader (`wallInfo`,
`houseInfo`, `houseStyle`: material, trim and door/shutter colors from a small palette texture, foundation height):
clapboard in an Ann Arbor palette, about one in five brick, some stone, stucco or shakes; sash windows, shutters on
some, a colored door on the front wall, gable and dormer windows, a visible foundation. Porches (posts or craftsman
brick piers, railings, a lean-to roof), steps (run out from the porch to the first spot the lawn can be reached at a comfortable pitch, ~19 cm risers; on a yard too steep for that, as short a flight as 30 cm risers allow; never out past the sidewalk), porch lights, shrubs and front walks that stop at the back of the sidewalk; railings, steps,
shrubs and lights are instanced and culled by distance. Everything is seeded by the house's position.
Residential blocks have a grass tree lawn between the curb and a
narrow sidewalk (`TREE_LAWN` in the generator, drawn with the lawns); street trees stand in it without pits
(`tree-placements.js`).
Driveways (`GEO.driveways`, drawn in `city-grid.js` as blacktop or concrete) are the paving from the city's 2023
Impervious Surfaces map (no license stated; https://a2maps.a2gov.org/a2arcgis/rest/services/ImperviousSurfaces/MapServer/7)
on residential lots, less the buildings; from each end of a piece that comes near the curb (the city often maps a
walk and its driveway as one piece, so each end is measured on its own) a strip runs out: a front walk
(under 1.9 m across, or up to 2.6 m when it leads back to a house rather than a garage: `leads_to_house`) to the
back of the sidewalk, never over it, a driveway (2.6 to 7 m) to just inside the curb, where a flared concrete ramp (`GEO.curbCuts`, city-grid.js) runs down over
the curb to the gutter. Only pieces that reach the street or a small building (a garage) are kept (back patios and
stray bits read as dirt from above), and none in parks, whose paths are the trails; a piece that is nearly a rectangle is drawn as one, the rest simplified.
Most are pale concrete; a quarter, and pieces over 120 m², are mid-gray blacktop.
Trails (`GEO.trails`, OSM paths, footways, bike paths and tracks inside parks, woods, the cemetery and lawn blocks,
not sidewalks or golf courses) are flat ribbons from `buildTrails` in `golf.js`: dirt for unpaved, gray paving else.
Golf courses (`golf.js`, `GEO.golf`): fairways, tees and greens are the park lawn's own grass mown a little lighter in soft stripes (`createParkLawnMaterial(false, { width, lift })`), their outlines rounded off (`smooth`), greens with pins, bunkers, cart paths. Huron Hills has only its outline in the city's data: its 18 holes are OpenStreetMap's golf=hole lines (golf-holes.js, Assets/Tools/build-golf-holes.py), laid out by `layOutHoles` as a tee, a fairway strip (holes over 190 m), a green with its pin and bunkers; the course's open grass round them is rough. A course with no greens and no hole lines gets holes laid along its fairways. The full map draws fairways, greens (and tees) and bunkers (city-map.js, using `layOutHoles` too). Railways
(`railways.js`, `GEO.rail`) lay track with ties and run trains that sound their horn (`audio-events.js`); cars and people ride on top of the
track (`trackTop`, used by `getGroundHeight` in controllers.js) and trains are solid, immovable bodies to the car
(`collideTrains`). Parked cars (`parked-cars.js`) fill parking-lot stalls and the curb parking lanes, never within
3.2 m of a track (`nearTrack`), near ones in full with wheels, far ones as simple
shapes; traffic is 70 cars and up to 16 buses. TheRide buses (`theride.js`, `data/theride.json.gz` from
`Assets/Tools/build-theride.py`, which reads TheRide's GTFS feed unzipped in .lamp/reference/gtfs): every trip on the
road now by Ann Arbor's clock and calendar (a date outside the feed's dates is moved by whole weeks into them) is given
a bus where its timetable puts it near the player, on its route's path matched to the road edges, stopping at each
real stop until its departure; stop signs stand at the curb by each stop. Buses wear plain city-bus colors, never TheRide's livery or logo (that needs
their permission): white, pale gray top, dark green band (`bus.js`); stop signs are plain green BUS STOP plates; the
bus's sign shows route number and destination. Rebuild the data when the
feed changes (it runs to Jan 2027). Curb parking lanes (`curb-parking.js`): the build's `park_spec` reads OSM
parking:both/left/right (untagged: Main, Liberty, Washington, State and S University downtown only) into link field 12
(bits 1 right, 2 left as drawn) and widens the street 2.4 m per side; traffic lanes stay inside them, road paint draws
each lane's line and its 6.5 m stall marks, and parked cars stand in those stalls.
Storefronts (upstream's `createStorefront` in tsl-materials.js): only on buildings marked `storefronts` in buildings.js (a shop building in the survey, or a shop or mixed-use parcel; never the University's, houses or churches), on their front walls (`WALL_KINDS.shop` in building-footprints.js); muted glass and frames, no painted sign names (`SIGN_NAMES = false`: the real names come from shop-signs.js). Other fronts get upstream's building entrances, and their ground floors keep the same windows as the floors above (the person wanted them to match). No awnings (the person disliked them): building-details.js makes only the odd scaffold shed.
A block is paved over (no lawn) only where its buildings and the city's paving map leave under a fifth of it
unpaved (downtown's Main and State Street blocks, strip malls, industry); campus and the neighborhoods keep grass.
A park's or golf course's slab (an odd-shaped lawn block) is only its sidewalk ring, so the lawn shows inside.
Parking lots (OSM) are striped by `parking-stripes.js`: an overlay whose stalls run off each lot's longest edge.
Park, wood and yard trees (`GEO.woods`) fill the city's Urban Tree Canopy map
(https://a2maps.a2gov.org/a2arcgis/rest/services/NaturalFeatures/MapServer/10, no license stated) about 7.5 m apart,
plus OSM's mapped trees; every surveyed park tree is kept, at its surveyed size, and only canopy fill within 2.5 m
of one is left out (`dropCanopyFill` in tree-placements.js), so the woods (Bird Hills, Barton) stay whole; playgrounds (OSM, `GEO.playgrounds`) get wood chips, a play tower and swings (`playgrounds.js`).
A house wall the paving runs up to gets a garage door (`GEO.garageDoors`, single or double, drawn by the house shader).

More from the generator, each in `GEO`:
- Street classes, one-ways, lanes, bike lanes and speed limits (OSM) on the road graph, a street OSM gives no limit
  taking the city's Road Centerlines `SpeedLimit` (RoadsSpeedlimitCrash/MapServer/1, no license stated; matched within
  12 m and in line). Traffic (`traffic.js` CLASS_TRAFFIC) spawns and turns mostly onto main roads, few onto side
  streets and alleys, at each street's limit; `road-paint.js` paints lane
  lines and bike lanes (a centre turn lane ending at a bend tapers its solid edges into the double yellow that goes on), and continental crosswalks only where OSM maps a painted crossing (`GEO.controls.crossings`
  `[x, z, marked]`: 1 painted, 0 not, 2 not said, which gets one only at traffic lights), mid-block ones too.
- Traffic lights, stop and yield signs (`GEO.controls`, OSM) drawn by `traffic-controls.js`, lit by `signalPhase` in
  `city-config.js`, the same clock traffic obeys.
- Street trees by species and height (the city's inventory; `trees.js` SPECIES) and streetlights
  (`GEO.streetlights`, the city's Streetlights layer, no license stated). "Now" works out the real sun (`sunTimes`).
- Storefront signs (`GEO.signs`, OSM named shops, food, bars, services; `shop-signs.js`, one atlas) on the wall of the
  building each is in that faces the street; building names (`GEO.places`, the footprints' `Bldg_Name`) show in the
  location label as you pass (`buildingNameAt`).
- Amtrak's Wolverine (`data/wolverine.json`, `Assets/Tools/build-wolverine.py` from Amtrak's GTFS feed,
  https://content.amtrak.com/content/gtfs/GTFS.zip, unzipped in .lamp/reference/amtrak/feed; the feed states no
  license): each train's stop at Ann Arbor, [train, west or east, headsign, arrival, departure, days, first and last
  date]. `railways.js` runs the Michigan Subdivision's passenger train on it by Ann Arbor's clock (`runTimetable`):
  braking in toward the Depot Street station (`STATION`), standing at the platform until its departure, pulling out
  with its horn; with no train due it's out of sight. The two freights still run back and forth. Rebuild the data
  when the feed changes (this one runs to Oct 2027).
- Railroad crossings (`data/rail-crossings.json`, OSM level crossings, `Assets/Tools/build-rail-crossings.py`): every
  one gets gates (`railways.js` buildCrossingGates), a mast with crossbuck and red lamps at the right-hand curb each
  side, whose arms come down and lamps flash while a train is within 160 m.
- Street furniture (`data/street-furniture.json`, `Assets/Tools/build-street-furniture.py`): the City of Ann Arbor's
  Fire Hydrants (ckan.a2gov.org "fire-hydrants", no license stated), each moved onto the curb if its point is in the
  street and turned to face it; its Park Amenities ("park-amenities"): benches, trash cans, picnic tables, grills,
  drinking fountains, bike racks and picnic shelters; and OSM `leisure=pitch` courts (tennis, basketball, pickleball,
  volleyball, soccer; indoor ones left out), painted with their lines, nets, hoops and goals and draped on the ground
  (`street-details.js` section 6). Only the shelters cast shadows. Benches and trash cans go flying when hit
  (`throwThing` in knockdowns.js). OSM's `amenity=public_bookcase` points are Little Free Libraries, a post with a
  little roofed box (Little Free Library publishes no open data).
- The underwater tint needs riverDepth > 0.08 under the camera too, since the river's level runs over land (Michigan Stadium's sunken bowl went green-tinted before).
- Underwater: a car or bike driven into the river takes the follow camera under once its roof is below the surface (`cameras.js`, clamped between the bed and the surface); while the camera is under, main.js sets `lighting.uUnder`, which turns the aerial fog into a close green-brown murk (`createAerialFogNode`, colour from the preset's fog × UNDER_TINT), and shows a tinted wash over the view. The water surface is double-sided so it shows overhead, and partly clear (`opacityNode` in `createWaterMaterial`: the bed shows looking down, a mirror toward the horizon, a window to the sky from under). The bed under the water is muddy dirt: dark brown silt mottled with lighter mud, faint current ripples and a few half-buried pebbles (`riverbedMaterial` in river.js, by each point's `wet` depth, full from just under the surface; the user turned down the old sand, cobbles and weed look). The jump camera stays above the water at its spot and at the landing spot, so a jump into the river is seen going in.
- Swimming: on foot in river water deeper than 1.3 m (riverDepth > 0.08, out again under 1.05 m) the player swims (`p.swimming`, updatePerson in controllers.js): 2.6 m/s, slower turns, no jump, held about 1 m under the surface (a fall in sinks, then bobs up), no foot shadow. PersonRig.swim (pedestrians.js) treads water upright when still and blends to a breaststroke (SWIM_ARMS / SWIM_LEGS keyframes) when moving. Getting out of a boat (`placePersonBeside`) steps onto a dock or bank only within 3 m; farther out the player goes over the side into the water beside it, swimming where it's deep.
- Splashes (`water-splash.js`; the river's level is defined over land too, so in the water means riverDepth > 0.08 as well; tracked from main.js each frame for the active car, sport bike, bicycle or walker; a walker makes a splash only jumping or falling in, then just ripples): drops are hair-fine glassy streaks like the hydrant's (edge-lit, clear in the middle; the user found bigger drops looked solid) with plenty of lingering spray; crossing the surface going in throws a glassy crown (flared open cylinder, TSL tear), a curtain of instanced drops, spray puffs and spreading foam rings, scaled by speed, fall and size; coming out, water pours off the body and the wheels fling a wash; wading at speed with the body breaking the surface makes a bow spray and a foam wake. Sound: the 'plunge' cue (audio-events.js, the paddle splash slowed and layered, then pattering) going in, 'splash' coming out, and a rumble.
- Earbuds: out of a car (on foot, either bike, the kayak) the radio dial is the player's earbuds, off by default, the chosen station saved as `phones` in the 'radio' save (radio.js). While one plays, `controllerManager.earbuds` shows white wireless earbuds on the player's head (`makeEarbuds`/`placeEarbuds` in controllers.js, in head-bone space; hidden under a motorbike helmet).
- The player looks the same on foot, on the bicycle and in the kayak (`PLAYER_LOOK` in controllers.js). The video board's back shows the Block M polygon (`BLOCK_M`), not a font letter.
- Potholes (`potholes.js`, `data/potholes.json` from `Assets/Tools/build-potholes.py`): the open pothole reports in
  the City's SeeClickFix 311 system (what a2potholes.com maps; fetched when the script is run, not live), each moved
  from the curb onto the street beside it into the wheel path, bigger the longer it's been open; one instanced patch
  of broken asphalt whose normals lean in. A wheel through one jolts the car or bike (`jolt`, after `carVertical` in
  controllers.js) with rumble and a thud (`onPothole` in main.js).
- Kayaks on the banks (`kayak-launches.js`): two or three pulled up on the grass by the river at each park it runs
  through (Argo, Bandemer, Riverside, Island Park, Gallup, the Arb...); walking up to one and getting in (the car key)
  puts the player's kayak in the water there facing downstream (`choice.beach` in main.js, `enterOrExit` in
  controllers.js).
- Gallup Park canoe livery (`gallup-livery.js`, OSM ways 292066180 and 458993137-144): the boardwalk and finger docks
  (planks one by one on stringers and round pilings, walkable via `dockTop` in `rampTop`, and climbed out onto from a
  boat), steel racks of canoes and kayaks by the boathouse, six rental kayaks on the bank and up to ten pedal boats tied
  along the docks. Getting in (`choice.boat`) makes the player's boat that one (`dressBoat`: the kayak entity wears
  a pedal boat, `updatePedalBoat`, pedalled at about 3 mph with a lever and a turning paddle wheel); its spot stands
  empty (`take`/`release`, saved as `boat` and `liveryTaken` with the player). Four pedal boats and three kayaks with
  people in them wander the open water within 260 m. The Gallup Park landmark lands at the livery (`POINT_AT` in
  city-config.js). Boats bump: each is two circles along its keel, each dock run a capsule (`collide`, called from
  `bumpLiveryBoats` for the player's kayak or pedal boat, which shoves a struck boat aside); the people's boats clear
  docks, tied boats, each other and the player's boat in `steer`, and turn away from it. Standing on a dock calls the
  nearest of their boats (within 40 m) alongside to wait; `nearest` offers it (indices past the rentals), and taking it
  takes it from them: its people go over the side and swim for the nearest bank (`overboard`, `stepSwimmers`: the
  rig's `swim`, then wading and walking a few meters up the bank), gone once they've stood a while out of sight. The
  boat and its people come back elsewhere on the water on `release`.
- Footbridges (river.js `footbridge`): a Catmull-Rom curve through the deck's points, planks every 15 cm, glulam beams
  and fascias, round posts with ball caps, a rounded top rail, a handrail, a bottom rail and balusters every 11 cm;
  piers are paired round columns under a cap beam. Their walking surface is still terrain.js `footbridgeTop`. The map draws the water as two ponds either side of some footbridges, so `joinUnderFootbridges` (terrain.js) digs the channel through under each one with open water within 18 m on both sides, and `riverGaps` adds its water surface (city-grid.js).
- Top speeds are the real vehicles' (`CAR_HANDLING` speed in m/s, each line naming its model; `carDrive` lowers drag
  so each can reach it); the bike is 28 mph, the H145 helicopter 167 mph. The plane keeps 130 m/s, as asked.
- House numbers (`data/addresses.json`, `Assets/Tools/build-addresses.py`): the City of Ann Arbor's Address Points
  (ckan.a2gov.org "address-points", no license stated; download cached in .lamp/reference/aa/addr). `houses.js` gives
  each house with a front wall the number of the address point inside its footprint (else the nearest within a few
  metres) on a dark plate with brass digits beside the front door, one instanced mesh whose shader picks the digits
  from a 0-9 atlas (`plate` attribute). No taxi fares: Ann Arbor has no taxis.
- Land use and historic districts (`data/districts.json`, `Assets/Tools/build-districts.py`, read by `districts.js`:
  `landUseAt`, `historicDistrictAt`): the City of Ann Arbor's Land Use parcels and Historic Districts
  (ckan.a2gov.org, no license stated). Inside a historic district the location label leads with its name, houses
  take heritage colors (oxblood, greens, ochre, slate) with more brick, gables, porches and chimneys and steeper
  roofs, and other buildings under 30 m (not the University's) are old red or buff brick; church land gets stone or
  brick, industry and research plain tan brick.
- Roof shapes (`data/roof-shapes.json`, `Assets/Tools/build-roof-shapes.py`): OSM `roof:shape` on Ann Arbor's
  buildings (ODbL; download cached in .lamp/reference/aa/roofs), [x, z, shape] at each building's centre.
- Building looks (`data/building-looks.json`, `Assets/Tools/build-building-looks.py`, read by `houses.js`
  `setBuildingLooks`): how each house and shopfront really looks, decided once at build time; the game never calls
  the services and no photo ships. The assessor's year built and storey style (ranch, storey and a half, two storey,
  split level) from the City of Ann Arbor's parcels (WaterServiceLeadMaterialAll/MapServer/3 on a2maps.a2gov.org, no
  license stated; owners not downloaded) are used as stated, except a "ranch" whose floor area is 1.15 times its
  ground area or more, which has an upstairs (1.5 storeys, 2 from 1.3 times; 918 Hutchins): storeys set a house's height and roof, and a house built
  before 1915 takes the historic districts' look. Each building's street photo is the Mapillary image (Mapillary
  contributors, CC BY-SA 4.0) that best faces it: in the camera's view (its lens distortion counted), its wall seen
  head-on within 50 m, no footprint and few street trees in between; it is cut to the building and sent with the
  assessor's fields to Jev (TypeSafe System One, images) in one request: does the photo clearly show it (else the next
  best photo, up to eight; with --box, Jev first finds the building in a wider cut with a Box question, told where the
  camera's heading puts it, and is asked about the cut to that box when it is sure of it), wall material, wall color from the houses' palette, porch, shutters, dormers and, where
  OSM has no roof shape, the roof; for shops their facade, awning, display windows and frame color. An answer under
  its threshold (Choice confidence 0.5, color 0.4, roof 0.55; Noul yes at 0.7, no at 0.3) keeps the generated look.
  [x, z, code] per building, (x, z) inside its footprint; the codes' bits are described in `houses.js`. Shops'
  windows and frame color ride on their walls' WALL_KINDS value (building-footprints.js), so nothing is added to draw.
  Keys (TYPESAFE_API_KEY, MAPILLARY_TOKEN) come from the environment or ~/.lamp/reference/keys.env; downloads and
  Jev's raw answers are cached in .lamp/reference/aa/ (parcels, mapillary, looks/answers.jsonl).
- Gas stations (`data/gas-stations.json`, `Assets/Tools/build-gas-stations.py`, drawn by `gas-stations.js`): OSM
  `amenity=fuel` (ODbL; its download cached in .lamp/reference/aa/fuel). Each gets a white canopy with a plain
  colored band (no brands), pump islands with a column and two pumps each, and a lit underside at night. The canopy
  is OSM's roof outline, else the survey's canopy-shaped outline on the station (which `buildings.js` then leaves
  out), else set in the open part of its Auto Sales or Service parcel.
- Building owner (`Owned_By`): kind 5 University (collegiate red-brown brick or limestone, facades 8/9), kind 6 the
  city, county, schools and federal (tan civic brick or limestone, 10/9), in `buildings.js`.

What's Ann Arbor's by hand: `city-config.js` (`LANDMARK_SITES`, `TELEPORT_LOCATIONS`), `landmarks.js` (the Big House,
which clears the survey's buildings under its collider), `outskirts.js` (the farmland and ground around and under the
city), the names in `city-map.js` (`AREA_LABELS`), `cameras.js` and the HUD,
and the spawn points in `controllers.js`.

## Easy to change

- Time of day and the sky's colors: `TIME_PRESETS` in `lighting.js`.
- How a building, the roads or the park look: `tsl-materials.js`, `buildings.js`, `building-details.js`.
- The vehicles: `cars.js`, `bus.js`, `helicopter.js`; how they drive, fly and how fast: `controllers.js`.
- How busy the streets are: the counts in `traffic.js` and `pedestrian-system.js`.
- The HUD: `index.html` and `css/style.css`.
- What's drawn: `QUALITY` in `main.js`. Street lights and reflections add several seconds to the start and are off.

Keep it smooth: the log's `[frame]` line (every 10 s) gives each part of a frame's milliseconds, draws and triangles;
measured on campus (M4 Max): game logic under 1.5 ms, the drawing ~13 ms for ~1,380 draws and 11.4M triangles
(shadows included; the ground layers alone 3.6M in view), so it's the number of draws that costs. Try changes that draw more with the frame rate in the top left, and keep new geometry instanced or
merged like the rest. The whole city is built before the first frame, about half a minute in Lamp's preview: a look
takes that long.

Most changes go into the city as it's played, with nothing built again and the player where they are: the HUD's look
(`css/style.css`), how the player moves and the vehicles' tuning (`controllers.js`), the cameras (`cameras.js`), the
time presets (`lighting.js`), the map's drawing (`city-map.js`) and the controller (`gamepad-controls.js`), each a class
in a module ending with `hot(import.meta).accept()` from lamp-game.js ("Changes while it's played" there). Anything
else (`main.js`, `index.html`, what those constructors built once, a new module) runs the game's code again in place,
back where the player was, in a couple of seconds: `main.js` keeps the renderer and each part of the city
(`live.keep`), and builds a part again only when its own code, the generated data it's built from (its `from`:
`CITY_MAP`, `BUILDING_DATA`, `TREE_DATA`, `SUBWAY_DATA`) or a part it's built from (its `inputs`) changed, so a change
to the trees builds the street details, traffic and road paint again and the rest stays, and a change to the map data,
which nearly every part reads, builds the city again in place with the player where they are. A new part of the city goes the same way: built by its own
module into the group `cityPart` gives it, set on the ground inside that build, and kept in `main.js` with the data
it's built from as its `from` and the parts it's built from as its inputs. Something new that changes as it's played
(a mission, a race) goes in a module of its own, a class `main.js` makes one of.
Logo: an inline SVG in index.html (`.app-logo`): Burton Tower in navy against a maize sun over a road; the title is Go To Ann Arbor.

The page keeps every version of a module for as long as it's open, with whatever its variables point at, so what a
module holds at its top level is released when the code runs again: `hot(import.meta).dispose` for what the module
itself gathered, `release()` from the run or part that owns a system. Big tables that never change as it's played
(the buildings, the trees) are built inside `keep`, with what they're read from in `from`, so a run reuses them.

Memory (device-tier.js: light by default on desktop, full via `?tier=full`, phone on touch devices): the still parts of the city (main.js `still`, the streamed ground tiles, the streamed houses) keep their vertex data on the GPU only (gpu-only.js lets go of the script's copy once uploaded, sending out-of-sight pieces up after a few rounds). Where the tier streams (`TIER.stream` metres), parked cars come and go by 250 m cell (parked-cars.js, `onColliders`), trees by square kilometre (trees.js, `onObstacles`, their trunks solid through main.js), and the shop signs are painted at half size. With `?memory` in the address (`MEASURE_MEMORY`; nothing is measured otherwise), memory-report.js logs the count once built and as spare copies go; the phone setting aims under 450 MB (about 280 MB measured in the preview once settled, 415 MB at its peak; the full Mac setting about 1.1 GB settled, 1.8 GB at its peak). Ken MacInnis's pull request #1 coarsened the ground's cutting (16 cm, 5 m edges), shrank the shadow maps and the parked-car streaming, and culled far props, track and river tiles by distance. `?tier=phone` tries the phone setting. The map's heaviest layers are kept out of `city-geodata.js` (now about 2 MB; `Assets/Tools/split-geodata.py`, run at the end of build-annarbor.py, the full copy in `.lamp/reference/city-geodata.full.js`): the driveways, walks and lawns in 500 m squares (`Web/data/yards/<tx>_<tz>.bin.gz`, YRD1, with `index.json`), the woods' trees (`data/woods.bin.gz`) and the curb cuts (`data/curb-cuts.bin.gz`), read by `yards.js`. Where the tier streams, city-grid.js builds the yards as five streamed ground layers (`streamFromSquares` in terrain.js, made from each square's file as it comes near, cut and cached like the rest; raise `YARDS_LOOK` when their look changes); built whole (`allYards()`) otherwise. memory-report.js's `memoryCheckpoint` (main.js `markInit`) tracks the peak of what's counted while loading (city, kept ground, map data, the script heap where the browser tells it) and logs it at every step of the start, only with `?memory` too. Measured at the light tier: peak about 568 MB counted (656 MB before the split), kept ground 52 MB (111), map data 4 MB (32), about 330 to 390 MB once settled. With the whole city (Nov 2026): light peak about 665 MB counted, kept ground 99 MB, map data 6 MB, about 640 MB once loaded; the full Mac setting about 2.6 to 2.9 GB (CityGrid 555, CityBlocks 483, built whole); the phone setting not yet measured over the whole city. Streamed offline squares: 404 yard squares of 500 m, 6.9 MB, the biggest 65 KB; the rest (map 4.1 MB, buildings 0.5, trees 0.2, ground 4.1, 10 m heights 4.3, river 1.7, woods 1.8) is read whole at the start and built into 500 m tiles near the player.

Tree sizes (trees.js): a surveyed street tree grows to its real height (only a typo past 45 m is cut down); park, wood and yard trees (`likeStreet` from city-grid.js) take a height from the taller two-thirds of the surveyed street trees of their kind.

Electric cars: Tesla (fastback sedan), Ioniq 5 (boxy hatch) and Cybertruck (stainless wedge) are body specs in cars.js built on the sedan, SUV and pickup; they appear in town traffic, highway traffic and parked cars, drive with quick EV pull, and sound of tyres only.
Rivian R1S (from the SUV) and R1T (from the pickup) join them: oval corner headlamps, full-width tail bar, Rivian colors.

- Buses: on foot, F beside a bus at its stop gets on (its driver waits while the player walks up); the player rides along out of sight with the camera pulled back, and F at a later stop gets off at the door (traffic.js boardBus/busRide/leaveBus, controllers.js getOnBus/getOffBus, main.js getInOrOut).
- ONE WAY signs at the corners where one-way streets leave an intersection (traffic-controls.js).
- Burton Tower, Hill Auditorium and the Michigan Union are modeled by hand (campus-landmarks.js). The Union is in high
  detail with `wallKit`: leaded Tudor-arched windows in stone frames, oriels, buttresses, battlements, the octagonal-
  turreted tower and the State Street frontispiece with its portal.
- The Michigan Theater on E Liberty, facing Maynard St, is modeled by hand (michigan-theater.js, using campus-landmarks.js's `builder`): the survey's auditorium outline in brick with a stage house, the buff-brick front block (survey outline hardcoded as FRONT) with storefronts, the deep maroon marquee with bulbs and a lit soffit, and the MICHIGAN blade sign. Signs are CanvasTextures; signs and bulbs glow with uInteriorGlow. Two colliders keep the survey's two blocks out without touching the neighbors.
- The map's search field stops Space and the arrows from reaching the game's keyboard (lamp-game.js cancels them on the page), so spaces type.

- PFAS foam: river-pfas.js reads Michigan EGLE's Huron River PFAS sampling (nearest site to town, Barton Pond) at start; PFOS against the 12 ppt state limit sets waterDisturb.pfas (0-1), which the water shader (tsl-materials.js pfasFoam) turns into drifting off-white foam rafts, thicker in the cascades. Offline it uses the last known reading.
- Recording: the top bar's Record button (before sound; main.js makes it if the page predates it) records the 3D view and the city's sound with MediaRecorder (recorder.js), sent a second at a time to Native.swift (`videoStart`/`videoChunk`/`videoEnd`), which writes it to ~/Movies/Go To Ann Arbor and shows it in Finder; without the app it downloads.
- The helicopter wears an air-ambulance pattern (royal blue over a maize belly and nose, a maize side swoosh with pinstripes, blue/maize fin) with no words or logos (helicopter.js).
- Getting in (F) prefers the vehicle you face (`facing` in `enterOrExit`). Road-work dirt piles are tall, steep cones (`PILE` in road-work.js, climb limit 1.0) to jump off. Each closed block shows an orange road-work diamond on the minimap and full map (`workSites`, `drawWorkSign` in city-map.js).
- Playground towers have a wide yellow wave slide (3.8 m long, 2.3 m wide, blue lips) that cars and bikes drive up onto the deck and off its far side: `top` from `buildPlaygrounds` (playgrounds.js) is handed back as the grid's `playTop`, set on the controllers, and `rampTop` in controllers.js joins it with the dirt piles for the ground, tilt and climb.
- SPEED LIMIT signs (R2-1, traffic-controls.js `limitPost`): each street's real limit (`postedMph`, as traffic drives it), on the right past an intersection where the limit changes or a main street begins (about half the side streets turned into off a bigger road), and repeated about every 800 m on main roads and 550 m on collectors; one per limit and direction nearby. About 210 in town.
- Traffic riders (bikes, e-bikes, scooters, hoverboards, motorcycles) hit by the player's car or motorbike above ~10 mph are thrown limp (`throwRider` in traffic.js, PersonRig's ragdoll), lie a few seconds, get up (the dive's push-up), and walk back to their ride, which coasts to a stop on its side (`lieDown`), then get back on (`remount`); a ride more than 40 m away is left, and the rider is put back on once both are out of sight.

More landmarks (js/more-landmarks.js): the Michigan League, Rackham, the Museum of Art, Hatcher Library (front and stacks), Crisler Center, Yost Ice Arena, Kerrytown, the Farmers Market sheds, the District Library and Tower Plaza, each modeled on its survey outline (found by a point inside it). Their colliders are strips with `keepsSurvey` so neighbors stay; the first carries `replaces` (the survey building it stands in for), which the block filter drops.

Rule for every landmark: each named landmark is custom modeled by hand (its real shape, materials and signature details), never left as a survey box or a generic building. A new landmark gets its own model before it goes on the map or the teleport list.

The Diag M (js/diag-m.js): the bronze block M on a round granite inlay at the Diag's central crossing (839.5, 300.5), flush with the paving.

The Gandy Dancer (more-landmarks.js, gandyDancer): the 1886 Michigan Central depot on Depot St (survey building at 560,-840), fieldstone boulders, red sandstone arches, red hipped roofs with deep eaves, round cone-roofed tower on the street side, platform porch on the tracks side.

Graffiti Alley (js/graffiti-alley.js): the passage off E Liberty between the shops (x 483.5) and the Michigan Theater's west wall (x 491), back to the Liberty Square parking structure at z 1.2. Walls, end wall and pavement carry procedural spray-paint canvases (seeded, so the same each time). The survey ran the parking structure down the alley; a landmark collider's `reshapes: { from, to }` hands buildings.js the structure cut back to its face.
Both are in the teleport menu (index.html buttons, TELEPORT_LOCATIONS gandy and graffiti).

Teleport viewpoints (city-config.js TELEPORT_LOCATIONS, `view(x, z, targetX, targetZ, lookUp)`): each landmark's arrival is authored by eye for a clear view of its model (not snapped to the nearest street), with how far the camera looks up (`teleportTo`'s fourth argument sets `cameraSystem.lookUp`). A new landmark gets its own checked viewpoint and a tp-* button in index.html.

The Amtrak station (more-landmarks.js, amtrakStation): the 1983 one-story brown-brick station on Depot St (survey block at 429,-903), a clerestory glass band under a low hipped roof, a full-height glass front toward the parking, and a long canopy on posts along the tracks side.

Huron High School (more-landmarks.js, huronHigh): the 1969 school on Fuller Rd, modelled on the survey's one outline of it (found by 3746,-205): two round classroom pods joined by a diagonal spine with curved wings, three storeys of brown brick with ribbon windows set per wall at that wall's ground (the site slopes), a proud concrete fascia, the taller gym block on the north (its corners hand-placed inside the outline), glass dome skylights on both pods, rooftop units, and the main doors under a concrete canopy on the spine's south side. Its outbuildings stay survey blocks.

Landmark fixes from the viewpoint check: the Michigan Theater's doors sit on its face; arch steps scale by the arch's width; the District Library has its front wing and Fifth Ave entrance; Rackham's entrance is on the south; the Gandy Dancer's dormer is stone with arched windows. Michigan Stadium's outer wall rises with the ground round the bowl (smoothed so it isn't a sawtooth), the survey's thin scoreboard boxes at each end are replaced by the stadium's collider, and the video boards' backs carry a maize block M on blue.

Car radio (js/radio.js, Sources/Native.swift `radioPlay`/`radioStop`/`radioNow`, the `Radio` enum on AVPlayer): while driving a car (not a motorbike) with sound on, a live Ann Arbor station plays: WCBN 88.3, WEMU 89.1, Michigan Public 91.7, W4 Country 102.9, 107one 107.1, WTKA 1050 AM (StreamTheWorld's redirect and WCBN's Icecast; only those hosts). Each car comes tuned to a station of its own; the player's own car keeps their choice (`save('radio')`). R (Shift+R back) or the d-pad left/right tunes, Off is one stop on the dial; the dial under the camera row shows the station and the stream's song title. Where `LampNative` isn't (a browser, Lamp's preview) the page streams the station itself in one audio element (`webPlay`, kept on `window.__radioAudio` across code changes, retried every 5 s if it drops), with no song title. WCBN uses its 32 kbps stream; the others are 64-80 kbps.

Bike racks and e-bike docks (bike-racks.js, data/bike-racks.json from Assets/Tools/build-bike-racks.py, OpenStreetMap's bicycle_parking): rows of inverted-U stands where OSM has them (the city's park racks left to street-details.js), bicycles locked to about a third of the sides, and three hand-placed e-bike docks by the Diag (dock posts, a blue fleet, a kiosk under a solar panel). On foot, F beside a bike or a docked e-bike borrows it (controllers.js enterOrExit `rack`, main.js getInOrOut: the old ride is left parked); it's gone from its stand for the visit.

Map overview (city-map.js `drawOverview`): while the full map is zoomed in past the whole city, a small inset at the bottom left shows the whole of Ann Arbor's limits, the river and freeways, a gold box for what's on screen and a dot for the player; a click in it moves the map there.

Ann Arbor Municipal Airport (airport.js, airport-data.js from Assets/Tools/build-airport.py, OpenStreetMap): south of the city limits, inside the town: build-annarbor.py squares off the town's south end from z 4400 down to z 7200 round its fence (the hull of the two), so W Ellsworth, S State and the roads round it are the town's own (OSM fetched to lat 42.2125, 3DEP to z 8000, the ground grid's GZ0 -5070 so it reaches z 7218). Paved runway 6/24 with threshold bars, aiming points, centerline and edge lines; the grass strip 12/30; taxiways with yellow lines; aprons, all laid `PAVE` (22 cm) over the town's lawn, which controllers.js getGroundHeight adds on the airfield so cars and people stand on it; edge, threshold and taxiway lights, a rotating beacon on a lattice tower, red 6-24 signs, and a plane flying touch-and-go circuits (`update`); hangars of corrugated steel (a striped canvas texture) under gabled roofs with bay doors, tracks and lamps, and the FBO and offices with a window ribbon, parapet, roof units, a door canopy and an ANN ARBOR AIRPORT sign, with polygon colliders; every merge goes through `merged()` (all non-indexed, position/normal/uv, null skipped); two windsocks; three parked helicopters and the high-wing planes (`planeGeometries`: a lofted hull, airfoil wings, fairings, nav lamps; `PLANE_VERSION`) on the aprons, the tied-down extras spread 30 m apart, at most 9, each a craft to take; three rolling airstairs (`stairTruckGeometries`, `stairTop`, ridden up through controllers.js rampTop: from 0.35 m to a 4.95 m landing over 9.5 m, a jump off the top), each drivable (machine 'stairtruck', `takeStairs`): got out of, they stand where left (main.js parkStairs, the car hidden) to climb, and F or Drive takes them again (retakeStairs), saved in 'airportStairs' and 'airportStairsHeld'; two fuel trucks and two baggage tugs with carts (box colliders). F by a parked one takes it (`pad`, `take`): its spot stands empty while it's the player's (save 'airportTaken'), the one taken before goes back to its spot, and `dress` makes the player's flying machine that kind (`h.craft`, save 'playerCraft': a plane model of its own in the helicopter's tilt pivot, the helicopter's parts hidden, label Airplane, a longer chase camera). A plane flies by `updatePlane` on the helicopter's controls: forward throttle (to 130 m/s), back brakes, left/right turn (banking in the air), up/down pull up and push over; it lifts off from about 22 m/s, full lift at 36, sinks below it, keeps its speed in the air, climbing costs speed. The maps draw its ground with its runways, taxiways, aprons and hangars. Teleport: tp-airport.
