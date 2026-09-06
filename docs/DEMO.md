# A two-minute demo

Pitch: “Data Center Sim: Night Shift is a playable incident rehearsal. You investigate a thermal alert in a 3D facility, act on the evidence, and see how your intervention affects the systems around it.”

## Before presenting

Start with `npm run dev`. Rehearse the keyboard controls, inspection distance, and equipment locations. Choose guided mode for the first demonstration. Confirm sound is enabled only if the room can hear it. This build has code checks but no browser playtest, so a manual full run is still necessary before presenting.

## Story

1. **0:00–0:20:** Show the technician, facility, corner map, and live simulated readings. Explain that Rack B2 is getting hot and the player has to find the cause.
2. **0:20–0:45:** Inspect the rack and cooling equipment. Show that the player collects evidence rather than immediately receiving every answer.
3. **0:45–1:05:** Demonstrate the consequence of boosting cooling before reducing load. The constrained power circuit trips and the backup battery starts draining. Tell the audience this follows explicit simulation rules.
4. **1:05–1:40:** Migrate the rack workload, clear the obstructed floor intake, restore power when eligible, and allow the temperature to stabilize. Point to changing service health and telemetry.
5. **1:40–2:00:** Show the score and incident timeline. Explain how collected evidence, mistakes, and time determine the result.

If walking all the way through the cascade is too long, show a clean recovery live and use a recording for the alternate intervention. Do not promise the full chain fits two minutes until you have rehearsed the actual game.

## What to credit

Before importing sponsor assets: “The playable simulation is implemented with authored visuals. We added server-side sponsor asset workflows and optional Convex results storage; generated assets are the next integration step.”

After importing and checking actual artifacts, credit only what is present: World Labs for the environment, Tripo for equipment, Mint for generated sounds or models, Convex for saved run records. Keep receipts/job records for the submitted assets. The game does not currently use an LLM incident director or live data-center telemetry.

Track: **Physical AI & Simulation**, with an operator-training simulation as the concrete use case. It is a stylized scenario prototype, not a validated model of a real facility.
