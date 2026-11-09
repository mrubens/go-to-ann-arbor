Kind: game, drawn with three.js (Lamp's runtime in Web/lamp-game.js), at home on the Mac, played on the Xbox too (device-tier.js gives an Xbox its own 'xbox' tier, found by its user agent or Lamp's lamp-device.js: the phone's streamed city drawn within 600 m, a third as far, its hills' ground cut to 35 cm rather than 10 (terrain.js CORE_TOLERANCE from TIER.ground), at 1440x810 held there with `sharp` (the runtime's own size steps start from 1920x1080 and undid the tier's scale), with shadows within 140 m in 1024 px maps, 4x smoothed edges, no glow, and the countryside kept for its coarse ground under the city (3 m below on an Xbox), which fills where near ground hasn't streamed in yet; the Mac drew ~25M triangles in ~2,500 draws, ~14M of it the whole city's cut ground, so 'full' now streams the ground and houses within 1.5 km too; the Xbox's budget is ~1M and ~1,000). On an Xbox or without shadows (phone) the start compiles only the shaders of what's within 450 m of the player and compiles the rest between frames during play (main.js compileLater), with no culling-off warm-up frame. A player's car paint is a uniform in one material per kind per player (cars.js `slot`), and every kind is compiled a few seconds into play (controllers.js carsToPrepare, main.js compileLater), so getting into a car compiles no shader. The frame rate shows in the title badge between the name and the GitHub link.
Flow: the city opens where the player left it; a second controller connecting offers split screen once (a notice naming View), View on either controller turns it on and off, and it steps aside while only one controller is connected.
Look: a sunlit 3D Ann Arbor, Michigan at true scale (brick downtown, campus limestone, leafy neighborhoods, the Huron
River, Michigan maize #FFCB05 and blue #00274C on the Big House), with a translucent dark heads-up display over it: the
place and street at the bottom left over a minimap, the modes (Walk, Drive, Cycle, Fly, Paddle) at the bottom, the vehicle and
its speed at the bottom right in large digits over a thin bar filled to its share of the mode's top speed (`.gauge` in index.html and style.css; `buildDial` in main.js sets the scale; the person turned down a round dial, a flat bar gauge and a wide sweep dial), and time of day, Teleport, Map and sound at the top right.

# Ann Arbor

Slop Ann Arbor: Mr.doob's Slop New York (MIT, `Web/LICENSE-slop-newyork`, commit e35c06c in credits.json; its changes since 13dd142 merged in: road paint in culled chunks, crowd culling and a vertex-shaded far LOD for people, cell-by-cell tree LOD, fire escapes, storefronts and entrances, building collision, gamepad and car wheel material; then from 536a907 (7 Nov): the reworked walking, running and turning gait, the crouch-and-spring jump and landing, smooth stepping over curbs, bicycle braking with Space as a brake, the storefront sign heights, the shader skips for faded road and sidewalk detail, bloom at 0.35 scale and finer instanced culling. Kept ours: shadow tiles and cascade reach, the culling of big meshes, our road-bike top speed; left out the loading bar, the minimap's traffic dots and the storage-buffer change) moved from
Manhattan to Ann Arbor. The city inside the I-94/US-23/M-14 ring, about 7 by 6 km, with every street where it really
is, every building from the city's surveyed footprints and heights, the Huron River, parks, the Diag, street trees from
the city's inventory, traffic and people; Michigan Stadium ("the Big House") modelled by hand.

- **Getting around**: 1 walk, 2 drive your own black compact SUV (a Subaru Forester look, Michigan "GO BLU" plates; Ann Arbor has few taxis), 3 cycle, 4 fly a sightseeing helicopter (it starts on the ground at the airport, in the middle one of the helicopters parked by the FBO: `startInHelicopter` in main.js, `atAirport` in SCENIC_STARTS; facing Michigan Stadium, `face`); the town's helipads (helipads.js, from OpenStreetMap: UMMC's heliport, Survival Flight's two pads and a roof pad on the medical campus; St. Joseph Mercy's is beyond the town's edge) are painted on the roof or ground under each, one merged draw, and the helicopter lands on them as on any roof; out of the helicopter under the parachute, each fresh jump press opens or folds the canopy (`updateChute`, a hidden trick with no hint), 5 paddle a kayak on the Huron (its current follows the river's real flow, below, carries it and turns it where the bow and stern feel different currents; only a blade in the water drives it, each stroke a surge, where a blade goes in and out the water's own surface ripples in rings, and a V wake runs off the bow, both tilting the water's shading, no overlays (`waterDisturb` in tsl-materials.js, set by `updateKayak`, `kayakRipple`, `updateRipples` in controllers.js); the HUD shows its speed over the bed; the Argo Cascades beside Argo Dam are paddleable: nine one-foot drops between rock weirs, from OpenStreetMap's channel and weirs (cascades.js: the water steps down weir by weir in `waterLevel`, the rocks block all but each chute, the current quickens through it, white water below tosses the kayak and it noses down each drop; the rapids are drawn in the water's own shader (`rapidsField` in tsl-materials.js: standing waves, chop and foam), the pond side of the dam is held at the pond's level behind a low wall (`DAM`, `pondSide`), the pond draws the kayak gently to the channel's head (`pondDraw`), and river.js cuts the water and banks every 3 m around the channel while leaving out dry land; the ground under the town (outskirts.js) takes the lowest ground around there so it never shows through). Kayakers and tubers float down from the cascades on a traced 2.4 km run, respawning at the top (river-people.js). F gets out of a car and into the nearest one, parked or moving (the moving one's driver is left behind; `enterOrExit` in controllers.js), and getting out of anything still moving is a jump (`bailOut` in controllers.js): out of a car above about 9 mph the player is thrown limp at the car's speed and the empty car rolls on to a stop or a wall; out of the helicopter in the air they drop, or from over 7 m skydive belly-down, spread-eagled (`skydive` in pedestrians.js; left and right turn, forward tracks: arms swept back, head-down, up to 30 m/s ahead while falling slower, back drifts backwards; the get-out hint says Jump out whenever getting out is a jump, `exitJump`), (the helicopter flies up to 200 mph, `maxHorizSpeed` in `updateHelicopter`, and climbs to 1,500 m, `HELI_CEILING`, faster above 250 m) until they pull a maize-and-blue parachute with the jump button, pressed afresh (`parachute`, `updateChute`: the camera falls back and looks up to take in the canopy; forward and back speed or slow the glide, left and right turn; never pulled, they splat and lie still a few seconds, `fallen.wait`) while the empty helicopter sinks to the ground (`coastEmpty`). The walking camera's framing is `WALK_CAMERA` in controllers.js (eased back after a fall, higher and looking down while the player is down). On foot inside Michigan Stadium's wall the player walks its field and stands (`carSurface`), kept in by the wall. Each car kind drives its own way (`CAR_HANDLING` in controllers.js: mass, top speed, pickup, grip, steering, body roll; optional `lock`, the widest steering angle, and `yaw`, how fast it turns in: the sport bike turns on a dime); traffic and parking include a low sports coupe (`BODY_SPECS.sports` in cars.js), the quickest to drive. Parked cars keep their lamps dark. Car crashes are rigid-body impulses: into walls and posts at the corner or face that touched, with bounce, sliding friction and spin (`carWallImpulse` in controllers.js); into traffic by mass (vehicle-physics.js); into parked cars, which are bodies of their own weight, shoved and spun, sliding to a stop on locked wheels and knocking the cars beside them (`shoveParked`/`settleParked` in controllers.js, `step` in parked-cars.js). On the bike, the map and minimap show protected and buffered lanes solid in a stronger green, other bike lanes solid, sharrows and signed bike routes dashed and paved paths and boardwalks thin (city-map.js). W A S D or the
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
- **Split screen** (`split-screen.js`, `showSplit` in main.js): with two controllers, View splits the screen left and
  right. The second controller's player (pad 1) has their own person, car (the sports car in Michigan blue), bike,
  helicopter and kayak (a second ThirdPersonControllerManager, keyboard and touch ignored, its lamps taken out so no
  light is added), their own follow camera and a P2 speedometer at the right edge; LB/RB bring the next way of getting
  around beside them, X gets in and out of their own things, Y their camera. Each half is drawn into its own picture and
  laid side by side through the colour grade without the glow (`createSplitView`); culling and the moon follow each
  half's camera; ground and house streaming keep tiles near both players (terrain.js, houses.js). Player 2 has a mini
  map in the right half's left corner (`CityMapSystem.addRadar`) and a camera chooser under their speedometer; both
  mini maps shrink to 220x140 in split. Only player 1 has the radio. Traffic, sound, the full map and parked-car swaps
  follow player 1. The first player's key bindings ignore untrusted key events: on the Xbox lamp.js turns every
  controller's presses into made-up arrow keys, which would steer player 1 from pad 1. Kept through a change in the
  snapshot's `split`. The game's log doesn't reach the builder here: triangle-report.js logs once a run what the
  camera draws, part by part (and puts it in an unseen element the window's text shows).
- The guide to the controls and the keys on the HUD's buttons show what the player is holding (`input()`, `label()`
  and `glyph()` from lamp-game.js, in `controlHints`, `renderControlHints` and `relabelKeys` in main.js).
- The game remembers where the player was between launches (`save('player')`, version 2 since the move from New York).
- **Badge and map**: the top left says "Go To Ann Arbor" and "GitHub ↗", which opens https://github.com/mrubens/go-to-ann-arbor
  (through `openRepo` in Sources/Native.swift in the app; a plain link elsewhere). Mr.doob's credit is in the app's
  About window and info (credits.json), not on the map (the person didn't want it there). The game starts with no GPS route; Teleport sets one and
  the full map's "Clear route" button clears it (city-map.js). With a controller the full map has a cursor
  (`MapSystem.gamepad`, fed by gamepad-controls.js's `onMapInput` while the map is open): left stick moves it and
  pushes the map at the edges, right stick pans, triggers or d-pad up/down zoom about it, A teleports there, X sets the GPS route there without moving; a mouse
  move hides it. A right-click on the full map sets a route without teleporting. Its prompt is drawn with glyph().
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
  - The animals (built in code, no files): `animals.js` runs them all near the view only. Squirrels (gray, fox-red,
    a few black) live on the city's tree trunks (the knock-down colliders) on the Diag, campus lawns, parks and
    neighborhood yards: forage, hop in bursts, sit up, flick tails, chase round trunks, come near someone standing
    still, and bolt up the nearest tree from anything coming; driving across the Diag scatters them; asleep at
    midnight. `river-birds.js`: mallards (drakes and hens) at Argo Pond, Riverside, Island Park, Fuller and Gallup;
    Canada geese on Gallup's water and grazing its lawns (they hiss and honk at someone on foot walking up, then
    waddle off); a great blue heron in the shallows below the Cascades (`CASCADE_FOOT` in cascades.js), lifting away
    slowly; a red-tailed hawk or two circling over the Arb and the river by day, crying now and then.
    `city-birds.js` (by 48 m cells, fixed by place, within ~110 m of the view, none at night): rock pigeon flocks on
    downtown and campus sidewalks and the Diag/Liberty Plaza (head-bob walk, peck, coo, drift to someone standing
    still, shuffle from a stroller, go up together in a wide circle and land nearby); house sparrows by the shops and
    in neighborhoods (hop, quick pecks, chirp, dart into the nearest tree and come back); robins on lawns (run, stop,
    cock the head, tug); crows in 2–4s on grass (long stride, caw runs, wariest, fly 35–80 m off). Up off the ground,
    rows sit on streetlight arms and signal mast arms (each pole's obstacle carries `arm`, read from its collider's
    `knock`), along gable and hip ridges (house colliders' `roofs`) and on treetops over 6 m: they look about, preen
    and call, ignore traffic below, flush when something comes level or the pole goes over; cells already peopled
    get their perchers once the street's colliders stream in. Up to 120 birds (56 on a phone). Coo/caw/chirp are
    synthesized in audio-events.js. `deer.js`:
    white-tailed deer (a herd of a buck with antlers and three does, another of three does) on two meadows of the
    Nichols Arboretum, at dawn and dusk only (the golden and twilight looks): graze, step on to fresh grass, stand
    head-up and watch anyone within ~38 m (let be if they stand still), and at ~17 m snort and bound off together,
    white tails flagged, then are gone until another dawn or dusk; they slip into the trees when it gets light or dark,
    and never come into being in plain sight. Skinned lofted body (winter coat, throat patch, eye ring, muzzle band,
    white tail underside), `poseDeer` for walk, bound, graze and alert; a baked stand-in past 110 m. Birds fly off
    low from boats (river-people.js's `people`), the player and the helicopter, and roost silent at night. Models:
    `animal-models.js` (the squirrel: skinned body, painted fur, `Body` the shared lofting kit) and `animal-birds.js`
    (the four birds: skinned bodies, painted feathers, wings that fold and spread, `poseBird`); each species shares one
    shape and texture, with a baked instanced stand-in far off. Their calls are synthesized in audio-events.js
    (chatter, quack, honk, hiss, wingbeat, hawk) and placed by `ANIMAL_REACH` in audio-system.js.
    THE RULE: animals are never struck, hurt or knocked down by anything (car, bike, helicopter, kayak, a falling
    player). They are never colliders, never in the knock-down or ragdoll code and never make a thud; they leave well
    before anything arrives, and one still reached quietly vanishes.
  - Art places (`art-places.js`): where each mural (`MURALS`) and sculpture (`SCULPTURES`) is, as plain data;
    city-config.js adds each to LANDMARKS with `art: 'mural' | 'sculpture'` (smaller pink or maize pins on the map,
    labeled from zoom 0.6, found by search, named by the street signs within 22 m). The teleport list is in sections
    (Downtown, Central Campus, Public Art, Athletic Campus, Parks & River, Around Town); Public Art has six arrivals.
  - Murals (`murals.js`): 13 of the city's best-known murals (the Bookstore Mural, "Challenge Everything. Create
    Anything.", the Michigan Wings, the Art Center's Art in Public Places walls round Ashley, First, Liberty and
    Washington...) on the real walls they're on (`MURALS`: wall ends from the city's footprints, the face, size and
    height). Each is our own painting in the spirit of the work (subject, motifs, palette), not a copy, drawn on a
    canvas into one 2048 px atlas (512 px each) and shown as one quad mesh just off the wall.
  - Public art (`public-art.js`): 20 outdoor sculptures at OpenStreetMap's points (Orion, Daedalus, the Milles
    fountain and his Sea Nymph and Unicorn, the pumas, bronze books, Flame of Wisdom, Zorn's stainless physics
    pieces, Begob, Tilted Donut, Indexer II, Aycock's swirl, Three Cubes, the Lorch Column, the Wave Field, the
    Rock), modeled from smooth parts (I-beams, tubes, lathes, rounded boxes), merged into one mesh a material
    (painted, corten, bronze, steel, stone, water, grass) with each piece's color in its vertices; a collider box
    for each piece's base. Pieces whose look can't be vouched for are left out.
  - The Cube (`the-cube.js`): Tony Rosenthal's "Endover" (1968) on Regents Plaza, at OpenStreetMap's point for it
    (node 1458141546, `CUBE_AT`), built in code: an 8 ft black steel cube on one corner on a short pivot post, each
    face four quadrant plates (some sunk, some with a shallow round recess or a raised panel); its shader wears the
    satin black paint to bright steel on the edges and corners at hand height and dirties it low down. It only turns
    about the upright: pushing (forward held against a face, on foot) builds slowly, a jump beside it is a shove, it
    slows over a few turns (`INERTIA`, `PUSH`, the drag in `update`), and passersby push it while the player's away.
    Its collider is a triangle, the section 1.2 m above its bottom corner, turned with it each frame; `onHit` (called
    from `resolveHorizontalCollision` in controllers.js) hears who touched it, so a car or bike's hit spins it by its
    momentum about the axis, with a clang (audio-events.js) in place of a crash (`quiet`), and a low grind from the
    pivot follows its speed (`cubeGrind` in audio-system.js). Teleport's "The Cube" arrives on foot (`foot` in
    TELEPORT_LOCATIONS); it's a map label in LANDMARKS; walkers route round `CUBE_FOOTPRINT`.
  - The West Park Band Shell (`band-shell.js`): on OpenStreetMap's outline (way 193803223), facing north to the park's grandstand. Five concrete arches telescoping back from the open front (each a band with a face reaching out to the one before), a half-round back wall and a backstage block, a raised stage on the outline with steps up the apron. The map says it's closed since 2021 and fenced in, so temporary chain-link panels (an alpha-tested diamond pattern on each panel's uv) ring it; their four sides and the shell are the colliders, the last carrying `replaces` for the survey's block. Its footprint keeps traffic and walkers out.
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
  Downtown Street Closures layer on today, plus MDOT MiDrive's Washtenaw total closures; the blocks OSM marks
  highway=construction are kept as streets by build-annarbor.py, so the closure shuts them) feeds `road-work.js`, whose
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
   cuts, woods, yards). The detailed area `LAND` is the limits with the township islands filled, buffered 120 m (now x -4677..6041, z -5009..7200, 90 km², with the airport, the freeway loops and the streets in `WHOLE_STREETS`, Elizabeth Road west of Maple, taken in whole with 90 m each side, their houses from OpenStreetMap where the city has no footprints, and their trees from `Assets/Tools/fetch-canopy-extra.py`, which reads tree cover off one small USGS NAIP aerial photo per street into `.lamp/reference/aa/canopy-extra/` since the city's canopy stops at the limits; run it before this step when adding a street):
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
Trails (`GEO.trails` `[kind, width, x, z…]`, OSM paths, footways, bike paths and tracks inside parks, woods, the
cemetery and lawn blocks, not sidewalks or golf courses, each taking the city's Non-Motorized Routes material where 60%
of it runs within 4 m of a line of one; plus the city's trails OSM is missing, kept 7 m off OSM's paths, 5 m off the
mountain bike trails and off streets, buildings, golf and water; plus its Shared Use paths beside streets, pushed out to
1.9 m past the curb, 3 m wide over the sidewalk) are flat ribbons from `buildTrails` in `golf.js`: kind 0 pale concrete,
1 dirt or gravel, 2 dark asphalt; kind 3 boardwalks (32 cm over the lawn, ramped at the ends, plank texture, walked
and ridden on through `top` in controllers.js rampTop) and 4 steps are `bike-routes.js`'s.
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
  12 m and in line). Bike lanes come from the city's Non-Motorized Routes (ckan.a2gov.org dataset de971a58…, no license
  stated, `.lamp/reference/aa/nonmotorized/`, fetched by fetch-annarbor.py), matched to each graph link the same way
  (12 m from its middle, |cos| ≥ 0.85, the highest kind winning: Protected > Buffered > Bike Lane > Advisory > Sharrow >
  Designated/Suggested); the city wins over OSM where it has a line, OSM's tags stay where it has none. A link's `bike`
  bits: 1 right, 2 left (as drawn), 4/8 sharrow right/left, 16 buffered, 32 protected (flex posts), 64 curb-separated,
  128 advisory (dashed both sides, no centre line, no room taken), 256 signed route (signs only), 512 two-way lane on the
  side its 1 or 2 says. `bike_room` widens or narrows a street with no OSM width by the lanes it gains or loses (1.7 m a
  lane, 3 m two-way, +0.9 buffer or posts, +0.6 curb). `GEO.bikeSigns` `[x, z, heading]`: BIKE ROUTE signs at the ends of
  each signed route and every 400 m, at the rider's right curb. Traffic keeps out of bike lanes (lanesOf fills the
  travel lanes between them and the curb); bikes and scooters in the outermost lane ride in the bike lane
  (traffic.js `locate`). Traffic (`traffic.js` CLASS_TRAFFIC) spawns and turns mostly onto main roads, few onto side
  streets and alleys, at each street's limit; `road-paint.js` paints lane
  lines and bike lanes (in its merged chunks: a solid white line and a bike-and-arrow every ~130 m, 10 m in from each
  end; buffered: a second line and 45° hatching every 3 m; two-way: a dashed yellow centre; advisory: dashed lines and
  no centre line; sharrows: a bike under two chevrons in the outermost travel lane every 50 m; `bike-routes.js` adds the
  flex posts (one instanced mesh, every 6 m, thin and with no collider), low curbs, boardwalks, steps and signs; a centre turn lane ending at a bend tapers its solid edges into the double yellow that goes on), and continental crosswalks only where OSM maps a painted crossing (`GEO.controls.crossings`
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
  OpenStreetMap's own benches, waste baskets, picnic tables, grills, drinking fountains, shelters, post boxes
  (blue mailboxes), flagpoles (with a flag) and recycling carts (Overpass download in .lamp/reference/aa/ovp/
  furniture.json) are added where neither map has one of that kind within 3-12 m: 956 in, 328 left out as doubles.
  One with no `direction` (yaw 9) faces the nearest street on a sidewalk. OSM street lamps are left out: the city's
  streetlights are GEO.streetlights.
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
- Speed humps and tables (`speed-humps.js`, `data/speed-humps.json`), curb carts (`curb-carts.js`,
  `data/collection-days.json`) and champion trees (`champion-trees.js`), all written by
  `Assets/Tools/build-humps-carts-champions.py` from the City's Traffic Calming, Collection Routes and Champion Trees
  data. Humps: placed by each built project's count, laid curb to curb; an axle crossing one jolts the car, and a front
  axle over `HUMP_LAUNCH` (11 m/s) launches it (controllers.js, after the pothole block). Carts: on today's pickup-day
  zone (Detroit weekday), trash + recycling (+ compost Apr–Dec 15 for ~35%) at the curb of each single/two-family
  address; knockable as `cart` (knockdowns.js). Champion trees: real height and crown spread (trees.js scales by
  `spread`), added in street-details.js replacing street trees beside them, green tree badges on the minimap and the big map at
  every zoom (LANDMARKS `art: 'tree'`, `drawTreeSign` in city-map.js); within 40 m of one the place label names it with
  "T to view" (main.js `updateChampion`; the found set kept with `save('championFound')`); every landmark's place label
  has the same hint (`viewLandmark`, sized by `VIEW_SIZE`). T or the pad's d-pad up starts `cameraSystem.startFlyover`
  (cameras.js), a slow circle round it; for a tree a plain caption (`.champion-card`, no box) hangs over the crown with
  its name, Latin name and size. Escape/B, a driving key or the stick ends it. Champion trees are `fixed` (can't be
  knocked down); knocked carts can be hit again once they land.
  A flying cart, can or bench (knockdowns.js `flying`) knocks down walkers and throws riders off it reaches (main.js
  after `knockdowns.update`, through traffic.js `knockBy` to pedestrian-system.js `knockBy` and `knockRiders`). Humps: one chevron per slope per lane pointing the way it drives
  (">>"), the right-hand lane only, the middle on one-ways; no posts. One-way signs stand off the pavement. Live bike counts were looked at and aren't reachable (the counters' site has no open feed).
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
- Driving is the top trim of each real vehicle (`CAR_HANDLING`, each line naming its model and 0-60): top speed, launch
  pull and power (acceleration/powerSpeed worked back from its 0-60 time and power), real air drag, braking from its
  60-0 distance; grip, cornering and wheelbase stay the game's sharper turning (`carDrive` grip ×1.3, cornering ×1.45,
  steer ×1.6): the person found the real skidpad figures too tough to steer; the bike is 28 mph, the H145 helicopter 167 mph. The plane keeps 130 m/s, as asked.
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

Electric cars: Tesla (fastback sedan), Ioniq 5 (boxy hatch) and Cybertruck (stainless wedge) are body specs in cars.js built on the sedan, SUV and pickup; they appear in town traffic, highway traffic and parked cars, drive with quick EV pull, and sound of tyres only. The fastback (kind 'tesla', shown as "EV Sport Sedan", no badge) drives as a tri-motor performance sedan: 13 m/s² off the line (60 mph in about two seconds) and 200 mph flat out; the speed dial's scale reaches any car's top speed past 160 (`buildDial(mode, drive)`).
Rivian R1S (from the SUV) and R1T (from the pickup) join them: oval corner headlamps, full-width tail bar, Rivian colors.

- Xbox (device-tier.js `xbox`): its processor is the limit (each draw's setup), not its graphics or the screen size. Before (Nov 2026, the person's figures): about 30 frames a second in one view and under 20 split, 650-990 draws a frame. What it gets now, the Mac unchanged:
  - No sun shadows (their two cascades were ~40% of a frame); ground-shade.js lays soft blobs under trees, benches, lamps, bins, hydrants, people and parked cars (one instanced draw, one for the cars) and a dark band along the foot of buildings, within 120 m, laid out again every 10 m. Split screen draws no sun shadows on any tier (showSplit), and the split views' targets name their color 'output' so the materials writing several outputs draw into them.
  - Trees (`mergeTrees`): a level's 14 species and variant shapes are one geometry (`aKind`), each tree its shape (`aTreeKind`), the material folding the rest to a point: one draw a level a cell, where that level's merged triangles stay under 60k (the log says which). Trees cast no shadow without shadows.
  - Landmarks (`landmarkReach`): same-looking materials shared before merging (merge-static.js `share`, e.g. the stadium field's planes and boxes), the town-wide campus and more-landmarks meshes cut into 300 m squares (`splitByCell`), each hidden beyond ~1 km; the airport's whole field hidden from over 1 km past its edge (but airstairs left elsewhere).
  - Camera far plane 14 km (`far`) instead of 60, where the haze at street level already hides the rest; drawn at 1920x1080 (`scale: 1`), not 1440x810 stretched up.
  - Arrivals (`spreadLoads`, `warmReach`): shaders of what's within 700 m (hidden too) made ahead of the player nearest first (main.js warmAhead); streamed ground squares put in one a frame, houses a square every fourth frame.
  - Measured (Nov 2026, Xbox log, trees still merged): 259-271 draws, 10.9M triangles (trees 8.35M of them), render 15-16 ms and logic ~9 ms (player & traffic 2.7, culling 2.0, animals 0.9) at 40-43 fps in a still view; one spike of render 78 ms. The person still sees ~20 fps in one view.
  - Since: trees unmerged on the Xbox was tried (`mergeTrees: 0`) and taken back (see Graphics lost); ground-shade.js's static buffers (people's own mesh, partial uploads) tried and taken back too; on the Xbox culling every 3rd frame and ground/house streaming every 4th (at once after a camera jump; every frame split), birds not flying thinking every other frame (city-birds.js `HALVED`), the traffic's spawn scan every 3rd frame.
  - gpu-probe.js logs once a `[device]` line (WebGL's GPU name, a fixed 4M-step JS loop's ms: under ~25 ms means the JIT is on, the GPU timer) and the [frame] line gives `logic`, `render` (processor) and `GPU` ms (EXT_disjoint_timer_query_webgl2). Next: if logic + render are 35-50 ms the processor is the limit; if small with GPU large, go back to `scale: 0.75` (1440x810). Not yet read back from the Xbox with these lines.
  - Graphics lost: a live change that built most of the city again on the Xbox lost its GPU context (three.js then renders 0 draws, black at 60 fps). Reloading the page doesn't help: the Xbox's browser then refuses WebGL to it (getContext null) until the app is closed and opened again. So main.js `graphicsGone` logs `[device] graphics lost` and puts up a screen asking to close and reopen the game, on a loss or when the renderer can't start. The loss came just after a "Shader Error 1282 VALIDATE_STATUS false" in the Xbox log, and then came on every fresh start within ~10 s (during the far parts' shader warm-up) while `mergeTrees: 0`; trees merged again on the Xbox (60000) as the first suspect, it having run with them before. Still lost with trees merged; ground-shade.js put back as it was and the GPU timer extension no longer turned on. It still happened with only CPU-side changes left; a restart of the Xbox cleared it (the console's state after the first loss, during a live rebuild of the whole city). After the restart (trees merged, ground-shade.js as before): 30-31 fps, logic 5-6 ms, render 23-25 ms, 316-328 draws, 6.2M triangles (trees unmerged had been 3.24M in ~410 draws). The runtime had found drawing smaller didn't help, so the Xbox is vertex-bound, not short of processor or pixels: trees kept apart on the Xbox (trees.js `MERGE_TREES`) gave 3.8-4.4M triangles but 500-520 draws and render 34-40 ms: no faster. Render time follows draws (~70 us each: 320 draws ~24 ms, 505 ~35 ms), not triangles or pixels, so the Xbox's limit is each draw's cost in the renderer (three's WebGPURenderer on WebGL), on its processor. Trees merged again. Next: fewer draws on the Xbox (target ~250), or a cheaper renderer path per draw.
  - Fewer draws on the Xbox (only there): scene-culling.js `bundle` merges, in each culled part, the plain static meshes of one group that share a material, attributes, shadows and cull distance into one per 700 m square (`[bundle]` lines say how many went into how few); the props' chunks and the big batches' cells are 1200 m there (`XBOX_CELL`). A view drawing over 350 logs the triangle report again (at most once a minute) with a `most draws` line, mesh by mesh, to find what's left. After it: 216 draws standing still, 35 fps, render ~19 ms, logic ~5 ms. Driving fast (knocking trees over) 13-16 fps: 235-255 draws, 6.5-9.3M triangles, render 30-36 ms, logic 16-21 ms (player & traffic 6-8, street details 4-5), frames up to 480 ms. The [frame] line now ends with the slowest frame's own parts (`slowest N (part ms, ...)`), to find what the stutters are. Then, driving: 25-29 fps, 350 draws (RailTrack 25, CityGrid 82, StreetDetails 56, CityBlocks 47), render 25 ms; the stutters were the animals (100-170 ms frames, likely animals.js gatherTrees rebuilding its tree map from every collider each time the list's length changes); gatherTrees now reads only the colliders new since its last look, everywhere, so no animals on the Xbox (main.js hides them and skips their update; the person chose that). With the animals off: 37 fps standing in houses; downtown 23-25 fps at ~410 draws (TrafficControls 39, CityGrid 55, CityBlocks 47, ParkingStructures 23), render ~21 ms at ~350 draws. Rarer stutters left: light/map/weather/sound 180-290 ms once a minute ("Now" put on again re-baked the sky's environment map; lighting.js now bakes only when the sky has visibly changed: its settings in steps, or the sun ~2 degrees on), the house squares' builds (culling) ~70 ms, a render 128 ms. Reading it on the Xbox is the next step; a change to scene-culling.js builds every culled part again, so reopen the game on the Xbox rather than letting it take that change live. Then, for downtown (Xbox only): a prop's chunk with a cull distance under 600 m is shown only while the player is within that distance of the box its copies stand in (`spread`, set by chunkInstancedMesh), not of the chunk's middle, so the far squares' signals, signs and the like drop out; the garages leave out their stall lines and wheel stops and show their ribs and lights only nearer (parking-structures.js).
- Bleachers on foot: climbed from the front a row at a time (footboard, then seat), walked along and jumped off the sides or back (bleachers.js `top` and each collider's `stepOn`, used by controllers.js getGroundHeight and the walker's collider loop); cars and bikes are still kept out.
- Draw counts: landmarks' still meshes are merged by material into 400 m squares (merge-static.js); house trim, soffits, porches and walks go in a 'HouseTrim' mesh per 500 m hidden past 420 m; footbridge parts merge in 250 m cells. Draws, not triangles, limit the frame rate. Repeated live changes slow it; a fresh Reload restores it.
- Sitting: on foot, F beside a park bench (three places along each), a cafe chair, a picnic bench or a place on the bleachers sits down on it, facing its way (seats.js gathers them from street-details.js' bench obstacles, outdoor-seating.js and bleachers.js `seats`; controllers.js enterOrExit offers the nearest, sitDown/standUp, posed with the rig's `perch`). F, the stick or jump stands back up where they stood; a seat knocked over can't be sat on. The save keeps where they stood.
- Buses: on foot, F beside a bus at its stop gets on (its driver waits while the player walks up); the player rides along out of sight with the camera pulled back, and F at a later stop gets off at the door (traffic.js boardBus/busRide/leaveBus, controllers.js getOnBus/getOffBus, main.js getInOrOut).
- ONE WAY signs at the corners where one-way streets leave an intersection (traffic-controls.js).
- Burton Tower, Hill Auditorium and the Michigan Union are modeled by hand (campus-landmarks.js). The Union is in high
  detail with `wallKit`: leaded Tudor-arched windows in stone frames, oriels, buttresses, battlements, the octagonal-
  turreted tower and the State Street frontispiece with its portal.
- The Michigan Theater on E Liberty, facing Maynard St, is modeled by hand (michigan-theater.js, using campus-landmarks.js's `builder`): the survey's auditorium outline in brick with a stage house, the buff-brick front block (survey outline hardcoded as FRONT) with storefronts, the deep maroon marquee with bulbs and a lit soffit, and the MICHIGAN blade sign. Signs are CanvasTextures; signs and bulbs glow with uInteriorGlow. Two colliders keep the survey's two blocks out without touching the neighbors.
- Address search: a search that starts with a house number ("918 hutchins") loads Web/data/address-search.json.gz
  (Assets/Tools/build-address-search.py, the city's Address Points: street names and [x, z, number, street]) the
  first time, then centers the map on that house and sets the GPS route there; no such house shows the street.
- Murals sit on the wall as drawn: murals.js steps each out from its measured line until clear of the building
- Only murals with `picture` in MURALS go on their walls, each from a photo of the real one (Web/assets/murals/, `crop` and `cropX` the part of it used) as its own draw at full size: so far the Bookstore Mural, from the person's own photo, which with `fill` sits on the lower half of its wall from the sidewalk up, centered, at most 55% of the wall's height and at the photo's own shape (`aspect`), with the building's brick showing above, and no shop sign on that wall (shop-signs.js skips signs in front of a filled mural). The rest are pins on the map until a photo of them comes; the old hand-painted cartoon versions (PAINT) aren't drawn. A mural sits from `up` (above the shopfronts) and shrinks to at most 70% to stay under the roof before it comes down.
  outlines, plus 0.25 m for sills.
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

Bike racks and e-bike docks (bike-racks.js, data/bike-racks.json from Assets/Tools/build-bike-racks.py, OpenStreetMap's bicycle_parking): rows of inverted-U stands where OSM has them (the city's park racks left to street-details.js), bicycles locked to about a third of the sides, and three hand-placed e-bike docks by the Diag (dock posts, a blue fleet, a kiosk under a solar panel). On foot, F beside a bike or a docked e-bike borrows it (controllers.js enterOrExit `rack`, main.js getInOrOut: the old ride is left parked); it's gone from its stand for the visit. The player's car or bicycle running into a parked bike (`strike`, from main.js's update with the active entity and a sound cue) sends it flying ahead, tumbling and bouncing, to lie on its side where it stops; it can still be borrowed there.
Swimming pools (pools.js, data/pools.json from Assets/Tools/build-pools.py, OpenStreetMap's leisure=swimming_pool, outdoor only): 127 pools, each a tiled basin (a pale aqua floor sloping shallow to deep with caustics, white tile walls with a dark blue waterline band) under see-through turquoise water just over the highest ground and lawn round it, in a pale concrete coping that steps down to the lawn, with ladders. The big ones (32) also have a concrete deck, dark lane lines ending in T's on the floor, red-ended blue and white lane ropes, starting blocks at the deep end and a lifeguard chair at each long wall; lanes run along the longest wall. The ground isn't holed: the basin draws first (renderOrder -2), then the water's outline just under the surface writes depth without colour (renderOrder -1), hiding the ground and lawn drawn after it there. Each layer is one mesh for all pools, the fittings instanced. The water is real: terrain.js `setPools` makes waterLevel and riverDepth answer for it, so the player swims, the camera goes murky under it and things splash in; getGroundHeight takes its sloping floor; a car or bike driven in sinks to the floor and can't climb out (pools.js `trap`), the player can.

Outdoor seating (js/outdoor-seating.js, data/outdoor-seating.json from Assets/Tools/build-outdoor-seating.py, OpenStreetMap): the 63 patios mapped as leisure=outdoor_seating, set with tables in rows along their long side, and a row of tables on the sidewalk in front of each cafe, restaurant and bar tagged outdoor_seating=yes that has no patio mapped, along its storefront (its sign in GEO.signs). Styles: 0 a cafe's round bistro tables with two chairs and a few umbrellas; 1 a restaurant's square tables for four, most under umbrellas, behind a low black railing; 2 a bar's picnic tables; 3 a patio of no food or drink place's, a few picnic tables. One instanced mesh per kind, culled in chunks past 160-320 m. Each table and chair is a knockdown (kinds chair, table, picnic thrown; parasol, a table with its umbrella, tips over); `seats` lists each chair and picnic bench place, for sitting later.

Ball diamonds (js/ball-diamonds.js, data/ball-diamonds.json from Assets/Tools/build-ball-diamonds.py, OpenStreetMap's baseball and softball pitches): 62 fields, home plate found as the corner from which a quarter-circle wedge holds most of the outline. A field deeper than 85 m gets 90 ft bases, a grass infield and a skinned arc round the mound; the rest 60 ft bases, skinned all over. The ground (striped outfield, dirt, chalk) is one mesh set on the terrain's slope; bases, plate, rubber, chain-link backstop, low line fences, an outfield fence (55 m and deeper), team benches are instanced (no light towers: OpenStreetMap's lit tags aren't reliable enough) and lifted to the ground. Chain link is a TSL weave fading to a haze past 30 m. `seats` lists the benches' places. Teleport: West Park Ball Field.

Bleachers (js/bleachers.js, data/bleachers.json from Assets/Tools/build-bleachers.py, after build-ball-diamonds.py): the 44 OpenStreetMap leisure=bleachers outside the stadiums, each its outline's smallest box facing the nearest pitch or track, and a three-row set behind the line fence of each ball diamond with none mapped within 60 m. Rows of aluminium seat and foot planks 0.38 m a step, on steel stringers, a back rail on 4+ rows; set level on the lowest ground under it. Instanced, planks scaled to length. `colliders` (solid boxes) keep cars out; `seats` lists a place a metre apart along each row.

Docks and boat launches (js/boat-docks.js, data/boat-docks.json from Assets/Tools/build-boat-docks.py, reading .lamp/reference/aa/ovp/boats.json from Overpass): every OpenStreetMap man_made=pier but the footbridges, paths and steps and the Gallup livery's own (gallup-livery.js draws those), as straight runs (a mapped outline becomes the run down its smallest box); and every leisure=slipway. A dock is a timber deck in 2.4 m sections, 0.45 m above the water out over it and 0.3 m above the bank on land, on posts to the riverbed, with up to three kayaks, canoes or rowboats tied alongside over deep enough water. A launch is a concrete ramp toward the nearest open water, from the bank to under it. `dockTop` is walked on (controllers.js rampTop) and `collide` keeps the player's boat off the docks and the tied boats (bumpLiveryBoats). A tied boat is boarded from the dock (controllers.js getIn `tied`, `nearest`/`take`): the player's kayak takes its place and its spot stands empty until another boat is taken (`release`); `docksTaken` is saved with the player.

Restrooms (js/restrooms.js, data/restrooms.json from Assets/Tools/build-restrooms.py, reading .lamp/reference/aa/ovp/stage-toilets.json from Overpass: amenity=toilets): indoor rooms left out. A mapped restroom building stands on its outline's smallest box in place of the survey's block (`replaces`): split-face block walls (`pat` 1, courses from world y) on a plinth, a louvred vent band, a shingled hip roof (`pat` 2), a steel door mid each long side (men's one side, women's the other) with a pictogram sign and a light lit at dusk; shelter=yes gives a deep roof on posts and a slab. A point (men's and women's within 10 m are one) is a 4.4 by 3.2 m restroom where it isn't inside a survey building, or a portable toilet (`pat` 3 ribs) where its toilets are chemical. One merged mesh, one for the lights; OBB colliders and pedestrian footprints.

Skate park (js/skate-park.js, data/skate-park.json from Assets/Tools/build-skate-park.py): the Ann Arbor Skatepark in Veterans Memorial Park from its OpenStreetMap outline (leisure=pitch sport=skateboard). One concrete height field sampled every 0.35 m: a 1.15 m quarter-pipe lip all round the inside of the outline with a bank down to the lawn outside (so the narrow north arm is a snake run), a 1.9 m round bowl at the roomiest end, a pyramid funbox in the plaza, plus a ledge, a manual pad (blocks) and a flat bar placed where they fit. Steel coping on the lip and the bowl's rim. `top(x, z)` is ridden, walked and driven on (controllers.js rampTop). Teleport: Skatepark.

Mountain bike trails (js/mtb-trails.js, data/mtb-trails.json from Assets/Tools/build-mtb-trails.py, reading .lamp/reference/aa/ovp/mtb.json from Overpass): the dirt paths tagged mtb:scale, mtb=yes or bicycle=designated on dirt (the singletrack itself is GEO.trails, golf.js). Along each, from hashes of where it is: rocks off its edges, roots across it (scale 1+), rock gardens in its tread (2+), logs to roll over and straight-bit tabletops (1+), a berm on the outside of every tight turn, and a post with a green, blue or black blaze at each end and every 300 m. Berms, logs and tabletops are ridden over (`top`, controllers.js rampTop).

Parking structures (js/parking-structures.js, data/parking-structures.json from Assets/Tools/build-parking-structures.py, reading .lamp/reference/aa/ovp/parking-structures.json from Overpass: amenity=parking parking=multi-storey and building=parking): each on its mapped outline (Liberty Square's cut back at Graffiti Alley), in place of the survey's blocks inside it (their colliders carry `replaces`; buildings.js leaves a replaced block out before any reshape). Floors from building:levels, else the survey's height every 3.2 m. The builder lays a ramp bay (down the middle where it's 34 m wide, else along a long wall) with room to turn at each end, the decks as the outline less the bay, and rows of stalls as a surface lot's (nose to the wall, aisle, nose to nose every 18 m). Drawn as one vertex-coloured concrete mesh each: an open ground floor on the ground, a slab per deck, precast spandrels with a cap and a reveal, columns every 7.6 m, the bay's two walls through every floor with light poles on their tops, end walls under the last ramp's high end and across the roof's hole, and a brick stair tower with a glass face in a corner; instanced stall lines, wheel stops and lights under each deck (lit at night). Every ramp climbs the same way, stacked a floor apart: `top(x, z, y)` gives the highest deck or ramp within 0.7 m above y, and controllers.js getGroundHeight takes it with the mover's own height (its 4th argument, else that mode's player's; -Infinity for the plain ground), so cars, bikes and walkers drive and walk up floor by floor and under the decks. Colliders (thin, keepsSurvey) are only as tall as each spandrel, so a car drives under the next floor's. About three in ten stalls hold a parked car, one in seven on the roof (parked-cars.js takes `stalls`; a car on a deck stands level, `deck`, at its height above the ground). `ceiling(x, z, y)` gives the underside of the deck over someone; cameras.js keeps the follow cameras between the deck the player is on and that one whenever the player or the camera is inside a structure. Street lights, poles and trees are never placed inside one (street-details.js `isClearOfPoles` takes `inside`). The spandrels stand 4 cm proud of the slabs' edges (INSET) so the two faces never fight; panel joints every 3 m, a drip under the cap, plinths and a corbel under each deck on the columns, double-tee stems (instanced per structure, RIB under the slab; `ceiling` counts them) with the deck lights between them, yellow-topped curbs up each ramp, mullions and a steel door per deck on the stair tower. One corner of each roof (the open convex corner with the longest walls, its run in clear of the ramp bay and the stair tower) rises gently over the railing (BANK: a wedge across the corner along its bisector, flat 9 m in, 1.45 m at 3.4 m in, steepening toward the top, so a car's nose clears the cap before the car gets there and it leaves upward), drawn as a shaded grid over the roof slab, with roof stalls left out of it; `top` gives the rise (`bank`). The old launch wedge was taken out as too plain; raising every corner was too many.

Map overview (city-map.js `drawOverview`): while the full map is zoomed in past the whole city, a small inset at the bottom left shows the whole of Ann Arbor's limits, the river and freeways, a gold box for what's on screen and a dot for the player; a click in it moves the map there.

Ann Arbor Municipal Airport (airport.js, airport-data.js from Assets/Tools/build-airport.py, OpenStreetMap): south of the city limits, inside the town: build-annarbor.py squares off the town's south end from z 4400 down to z 7200 round its fence (the hull of the two), so W Ellsworth, S State and the roads round it are the town's own (OSM fetched to lat 42.2125, 3DEP to z 8000, the ground grid's GZ0 -5070 so it reaches z 7218). Paved runway 6/24 with threshold bars, aiming points, centerline and edge lines; the grass strip 12/30; taxiways with yellow lines; aprons, all laid `PAVE` (22 cm) over the town's lawn, which controllers.js getGroundHeight adds on the airfield so cars and people stand on it; edge, threshold and taxiway lights, a rotating beacon on a lattice tower, red 6-24 signs, and a plane flying touch-and-go circuits (`update`); hangars of corrugated steel (a striped canvas texture) under gabled roofs with bay doors, tracks and lamps, and the FBO and offices with a window ribbon, parapet, roof units, a door canopy and an ANN ARBOR AIRPORT sign, with polygon colliders; every merge goes through `merged()` (all non-indexed, position/normal/uv, null skipped); two windsocks; three parked helicopters and the high-wing planes (`planeGeometries`: a lofted hull, airfoil wings, fairings, nav lamps; `PLANE_VERSION`) on the aprons, the tied-down extras spread 30 m apart, at most 9, each a craft to take; three rolling airstairs (`stairTruckGeometries`, `stairTop`, ridden up through controllers.js rampTop: from 0.35 m to a 4.95 m landing over 9.5 m, a jump off the top), each drivable (machine 'stairtruck', `takeStairs`): got out of, they stand where left (main.js parkStairs, the car hidden) to climb, and F or Drive takes them again (retakeStairs), saved in 'airportStairs' and 'airportStairsHeld'; two fuel trucks and two baggage tugs with carts (box colliders). F by a parked one takes it (`pad`, `take`): its spot stands empty while it's the player's (save 'airportTaken'), the one taken before goes back to its spot, and `dress` makes the player's flying machine that kind (`h.craft`, save 'playerCraft': a plane model of its own in the helicopter's tilt pivot, the helicopter's parts hidden, label Airplane, a longer chase camera). A plane flies by `updatePlane` on the helicopter's controls: forward throttle (to 130 m/s), back brakes, left/right turn (banking in the air), up/down pull up and push over; it lifts off from about 22 m/s, full lift at 36, sinks below it, keeps its speed in the air, climbing costs speed. The maps draw its ground with its runways, taxiways, aprons and hangars. Teleport: tp-airport.

- Strewn scooters (scooters.js `strew`): about 7% of 45 m steps along non-highway streets get a parked scooter on the tree lawn or sidewalk (deterministic hash, kept off medians and parks). The car, bike or cyclist knocks them flying above ~5 mph (`strike`/`fly`, crash and thud sounds); a fallen one lies down and can't be ridden.
- Speed limit sign (speed-limits.js `speedLimitAt`): a small US SPEED LIMIT sign at the right of the speedometer, shown in Drive and Cycle on a street. The number is the street graph's posted mph (OSM maxspeed or the city's), else the class default traffic uses (CLASS_MPH). Picks the street running the way you head; glows red over the limit by 10+.
- Speed limits also cover the main streets drawn from GEO.roads (named limit from the graph, else by lanes/width). Contrails (planes.js) are wide soft streaks shown only in midday/golden light; at night they read as dotted white lines, so they're off.
- Sign faces (stop, yield, speed limit, one way) sit 7 cm in front of their posts (traffic-controls.js plane/back), so the post is behind the sign. The HUD limit keeps showing 2.5 s after leaving a street, so it doesn't blink on corners.
- Freeway loops: build-annarbor.py adds to the town's land every freeway stretch (motorway/trunk and their links) that leaves the land and comes back to it (12 stretches, 2.6 km, ~110 m wide strips; e.g. M-14 by N Maple Rd), so the road, ground and traffic carry on through them. Rerun build-ground.py after it.
- Busier freeways: spawnVehicle in traffic.js puts a third of new cars on a nearby freeway link (cls 0, listed in nearFreeways) whenever one is near, since its few long links would otherwise get few cars.
- Drafted yards: drafted-yards.js draws each drafted house's yard (from Open Facades, `yard` in data/drafted-houses.json) inside the draftedHouses part: fences post by post by style (picket, rail, chain link, solid) and beds' mulch as two instanced draws, on the lawn. Shrubs, the beds' plants and hedges (in ~1.3 m pieces) are drawn by trees.js createShrubs from street-details.js with the trees' own leaf cards and material (yardLeaves), so they match the trees: one instanced draw each. Its trees go to street-details.js (yardTreeSites → the city's tree field, at their real height, species from leaves/shape/size: evergreen or conical → spruce, columnar → elm, spreading → oak or locust, round → maple or flowering); canopy fill trees within 6 m of one are dropped. Walks, driveways and lawns are left to the map's own.
- Drafted houses' draws: the renderer makes ~100 meshes per house; drafted-houses.js bakes them in place and merges them per 160 m cell by material (texture, roughness, metalness, transparency), with each piece's color in vertex colors: 65 houses are ~174 draws in all (was ~5,000 near them).
