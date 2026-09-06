# Data Center Sim: Night Shift

A standalone browser incident simulation, originally built for the **Physical AI & Simulation** hackathon track. Walk into a data center, follow a thermal alert, collect evidence, and recover service before a cooling incident becomes an outage.

**Project status:** I stepped away from the hackathon and am keeping this repository as a standalone prototype.

**No API credits required:** The default game runs locally without API keys, paid services, or redeeming any hackathon credits. All sponsor integrations are optional.

The entire local game runs without API credits. Its facility, technician, equipment, and sound cues are authored locally. Optional integrations can replace equipment with Tripo/Mint models, load a World Labs/Mint environment, use Mint audio, and archive completed runs with Convex. No sponsor generations have been purchased or performed during this build.

## Start the game

Use Node **22.12 or newer**. From Terminal:

```sh
cd /Users/natasha/Documents/GitHub/datacentersim
npm install
npm run dev
```

Open the localhost address printed in Terminal (normally **http://127.0.0.1:5173**). Keep that terminal running. Stop it with Control-C. You do not need an environment file for local play.

Choose a technician appearance and a guided or challenge shift. Follow the on-screen controls to move, change camera, inspect nearby equipment, and act on what you find. The corner map shows the facility and the thermal alert. Guided mode gives more direction; challenge mode adds a tighter clock.

| Control | Action |
| --- | --- |
| WASD | Move through the facility |
| Mouse drag | Look around in first/third person |
| Shift | Run |
| E | Inspect nearest equipment or close inspection |
| Click equipment | Inspect it nearby, or track it from a distance |
| Click minimap marker | Track that equipment |
| T | Toggle the illustrative thermal overlay |
| V | Switch third person, first person, and overview |
| Esc | Close inspection, then pause/resume |

Inspection stops movement but the incident keeps running. Use pause when you need to step away. Switching browser tabs automatically pauses the shift. Jacket color selection applies to the built-in operator; an imported character retains its own materials.

## The incident

Rack B2 is running hot. Its local air intake is obstructed, the rack is carrying heavy workload, and the power distribution unit has limited spare capacity. Boosting cooling prematurely can overload that power circuit. Inspect the rack, cooling cabinet, floor intake, and power cabinet to understand the chain of cause and effect.

A clean recovery is to inspect the evidence, migrate workload, clear the blocked intake, and let temperature and service health stabilize. If you trip the breaker, use the power cabinet to recover after reducing the load. These are authored training rules, not engineering calculations or instructions for operating real equipment.

The result screen records your time, evidence, mistakes, score, and incident timeline. The browser keeps recent runs locally. With Convex configured, each completed run is also saved remotely.

## Connect the sponsors

Follow [the full API setup guide](docs/API_SETUP.md). The suggested allocation is:

| Sponsor | Implemented connection | When it is used |
| --- | --- | --- |
| World Labs | Server-side world generation/status CLI and SPZ + matching collider loader | Generate a facility, then calibrate it against the authored level |
| Tripo | Server-side model generation/status/download CLI | Replace rack, cooling, power, or avatar GLBs |
| Mint | Server-side audio generation/status/download CLI, manual model/RAD manifest imports | Replace ambience/alarm, or import Mint-generated models/worlds |
| Convex | Optional validated anonymous run archive | Save results after a shift |

Keys stay in `.env.local`, and generation runs only when you explicitly run an asset command. A browser never receives provider generation keys. `VITE_CONVEX_URL` is a public deployment address, not a secret.

The default game does **not** claim to have generated assets or live telemetry from these providers. It remains an authored simulation until you import actual artifacts. Convex stores results; the simulation runs locally and is not multiplayer.

## Build and checks

```sh
npm run typecheck
npm test
npm run assets -- check
npm run build
```

The build goes to `dist/`. For a local production preview after building, run `npm run preview` and open the address it prints. To publish later, host `dist/` on a static host that supports WebGL applications. Keep `.env.local` and `work/` out of the deployment. If using Convex, deploy it with `npx convex deploy` and build with the production `VITE_CONVEX_URL`.

Verification scope for this delivery is **code and build checks only**. The user declined browser testing. Desktop gameplay, visuals, imported GLB decoding, remote environment alignment, audio playback, mobile controls, and performance still need an interactive check. Sponsor APIs and a deployed Convex backend require credentials and were not exercised live.

The build includes a large, optional Spark world-rendering chunk, loaded only when a generated environment is enabled. The built-in facility uses no generated world. The default UI's optional web fonts have system-font fallbacks when offline.

## Demo

See [the two-minute walkthrough](docs/DEMO.md). The central story is: one hot rack, a tempting intervention, a power consequence, and an evidence-based recovery.

## Files

- `src/simulation.ts`: deterministic incident rules and scoring.
- `src/world.ts`: facility, technician, camera, navigation, and interactions.
- `src/main.ts`: interface and state orchestration.
- `src/integration.ts`: optional imported asset loader and run saving.
- `src/gltf-runtime.ts`: shared Draco, Meshopt, and KTX2 model support.
- `scripts/assets.mjs`: local Node CLI for sponsor jobs and artifact import.
- `public/assets/manifest.json`: paths and transforms for optional runtime assets.
- `convex/`: optional run archive schema and functions.
- `.env.example`: empty credential template.
