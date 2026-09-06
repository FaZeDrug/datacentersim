# Connect sponsor assets after redeeming credits

You can play immediately without accounts. The commands below are optional and only make generation requests when you run them. The integration code was checked against official documentation on September 5, 2026; live requests need your redeemed account credits and have not been tested in this delivery.

## 1. Redeem first, then create keys

Use the organizer's actual redemption instructions or ask the sponsor desk for the event code. This repository contains no redemption codes and does not buy credits. Confirm your credit balance on each account before generation.

- World Labs: sign in at [World Labs Platform](https://platform.worldlabs.ai), then open API keys. Marble website usage and API billing can differ; confirm the event benefit applies to your API account. [Official quickstart](https://docs.worldlabs.ai/api)
- Tripo: open [Tripo API keys](https://developers.tripo3d.ai/en/keys). This integration uses the current v3 API. [Authentication and base URL](https://developers.tripo3d.ai/en/docs/introduction)
- Mint: sign in at [Mint Platform](https://platform.mint.gg) using the same account you redeemed credits on, then create an API key. The public API is separate from connecting Mint MCP to an agent. [Official API quickstart](https://docs.mint.gg/developers/quickstart)
- Convex: run the setup below when you want saved cloud results. It does not require the three asset provider keys.

Inside the repository, copy `.env.example` to a new `.env.local` file and fill the three key values there. Do not paste keys into chat or put them into `public/`, `src/`, or variables beginning with `VITE_`.

```dotenv
WORLDLABS_API_KEY=your_world_labs_key
WORLDLABS_MODEL=marble-1.1
TRIPO_API_KEY=your_tripo_key
TRIPO_MODEL=v3.1-20260211
MINT_API_KEY=your_mint_key
VITE_CONVEX_URL=
```

The model names above match current documented examples and can be changed in the environment if your event account has different model access. Never commit `.env.local`.

## 2. Start with one Tripo server rack

```sh
npm run assets -- generate tripo rack
```

This submits exactly one paid generation job and prints a job ID. It does not repeatedly generate or charge while you play. Replace `TASK_ID` below with the printed value:

```sh
npm run assets -- status tripo TASK_ID
npm run assets -- fetch tripo TASK_ID rack
```

Run `fetch` when status is `success`. It downloads `output.model_url` immediately, checks that the file is a GLB, inspects required extensions, and updates the rack slot in `public/assets/manifest.json`. All rack visual bodies use that model, while their equipment IDs, telemetry, collision proxies, and interactions stay intact. Downloaded files have content-based names, so a new import preserves earlier files.

Repeat with `cooling`, `power`, or `avatar` as desired. Imported avatars use the existing movement controller but do not automatically gain a new skeletal animation set. Static posing/locomotion appearance must be checked after import.

The current API uses `POST https://openapi.tripo3d.ai/v3/generation/text-to-model` with `prompt` and `model`, then `GET /v3/tasks/{task_id}`. The script never places authentication on the final storage download. [Tripo generation quickstart](https://developers.tripo3d.ai/en/docs/quick-start), [task response](https://developers.tripo3d.ai/en/docs/task-query)

## 3. Add Mint audio

```sh
npm run assets -- generate mint ambient
npm run assets -- status mint OPERATION_ID
npm run assets -- fetch mint OPERATION_ID ambient
```

Repeat with `alarm` for the warning sound. Imported audio uses the game's sound toggle. The local synthesizer remains available when files are absent or fail to load.

The CLI uses `POST /v1/audio:generate` with an explicit audio kind and duration, then checks `/v1/operations/{id}` and retrieves `/v1/assets/{type}/{id}/artifact-manifest`. It downloads a finished audio artifact and records the imported asset path. Provider API keys stay on your computer. The account-owned artifact record is stored in `provider-assets.json`; this is separate from the Mint MCP project's own registry. [Mint API contract](https://api.mint.gg/openapi.json)

If status is `billing_required`, resolve billing in Mint Platform. Resume an operation that has an intermediate resource through the documented operation-resume endpoint; do not start repeated new generations. A failed request is never automatically resubmitted. Mint generation receives a UUID idempotency key saved in `work/assets/request-*.json` so an uncertain request can be traced safely. [Mint status and billing lifecycle](https://docs.mint.gg/developers/api-overview)

If you prefer Mint's website/MCP workflow, generate and export one model or audio file and use the manual import commands below. To use a final Mint artifact manifest, save the JSON returned by its manifest tool and run:

```sh
npm run assets -- mint-manifest cooling /absolute/path/to/mint-manifest.json
```

For MCP-produced assets, also use the installed Mint skill's official `sync-mint-assets.mjs` workflow to maintain its `mint-assets.json` project registry. The game's separate manifest remains the runtime slot mapping. Mint MCP wasn't callable in the build session; nothing claims a successful MCP generation.

## 4. Generate a World Labs environment

```sh
npm run assets -- generate worldlabs world
npm run assets -- status worldlabs OPERATION_ID
npm run assets -- fetch worldlabs OPERATION_ID world
```

Generation uses `/marble/v1/worlds:generate`; polling uses `/marble/v1/operations/{operation_id}`. Fetch selects the 100k SPZ when available, keeps its matching collider URL, and records per-world metric scale metadata. [World Labs API](https://docs.worldlabs.ai/api)

**Worlds import with `enabled: false`.** A generated room will not automatically match this game's authored equipment coordinates. Its world, walls, and player spawn must be aligned before enabling it. This is the main manual integration step remaining after generation.

In `public/assets/manifest.json`, the world record looks like this:

```json
{
  "provider": "worldlabs",
  "format": "spz",
  "url": "https://the-returned-spz-file",
  "colliderUrl": "https://the-returned-collider.glb",
  "position": [0, 0, 0],
  "rotation": [3.141592653589793, 0, 0],
  "scale": 1,
  "enabled": false
}
```

Use the actual URLs and scale/offset saved by the CLI, not the illustrative values above. Both splat and collider are loaded beneath one root transform. The collider is invisible but checked for horizontal navigation obstacles. The authored equipment positions, room, and flat walkable floor remain, so align the environment to them or revise the level together. The game does not automatically climb generated stairs or follow arbitrary generated floors. Refresh after each transform change. Set `enabled` to `true` when ready to check it, and return to `false` to keep playing the authored facility.

Marble raw SPZ output needs scale and ground alignment before the Three.js axis conversion. The CLI uses the returned metric scale factor, applies the ground offset with the X-axis flip, and leaves the final root configurable. Provider collider coordinate conventions should be checked visually against the supplied splat. This project has not validated a generated room with your data. [Rendering SPZ correctly](https://docs.worldlabs.ai/api/rendering-spz)

A Mint-generated world can also be imported with:

```sh
npm run assets -- mint-manifest world /absolute/path/to/final-mint-world-manifest.json
```

That route requires a final remote-stream RAD URL and its matching collider. Spark v2 loads RAD with paging, and both assets share one transform. Keep those URLs remote; do not substitute a preview image for a world. Calibration is still required.

## 5. Enable Convex run saving

From the project directory:

```sh
npx convex dev
```

Sign in, choose or create the project for this game, and let Convex push the included schema and functions. Keep the command running during development. It writes the public deployment URL into `.env.local`; verify `VITE_CONVEX_URL` is populated. Restart `npm run dev` after adding the URL.

Finish a shift. `saveRun` always attempts to keep the result locally, and additionally calls `runs:save` when the Convex address exists. Check the `runs` table in your Convex dashboard. `runs:recent` returns the twenty most recent result summaries and can support a future shared results screen. [Convex Vite quickstart](https://docs.convex.dev/quickstart/react), [mutations](https://docs.convex.dev/functions/mutation-functions)

The cloud archive accepts anonymous, bounded, client-reported scores and deduplicates run IDs. It is for a hackathon demo, not a verified public leaderboard: there is no login, anti-cheat system, multiplayer synchronization, or real equipment connection. Only score, outcome, mode, duration, inspection count, and mistakes are sent. A missing address, deployment error, or offline network does not block the local game.

## Manual imports and adjustments

You can download/export assets in a sponsor website without using the CLI generation endpoints:

```sh
npm run assets -- import rack /absolute/path/to/server-rack.glb
npm run assets -- import cooling /absolute/path/to/cooling-unit.glb
npm run assets -- import power /absolute/path/to/pdu.glb
npm run assets -- import avatar /absolute/path/to/technician.glb
npm run assets -- import ambient /absolute/path/to/server-hum.mp3
npm run assets -- import alarm /absolute/path/to/warning.wav
npm run assets -- check
```

Models are centered on X/Z, placed on the floor, and uniformly scaled to `targetHeight` in the manifest. Change `rotationY` (radians) for a backwards-facing export; change `targetHeight` for scale. Materials and textures are preserved. The shared loader supports Draco, Meshopt, and KTX2. Draco and KTX2 may need decoder downloads, so validate one real asset with an internet connection before a demo.

`npm run assets -- prompts` prints the editable generation briefs. To alter them, edit the `prompts` object in `scripts/assets.mjs`, then intentionally generate a new asset. Do not regenerate while merely debugging scale or rotation.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| CLI says a key is missing | Put the corresponding key in repository `.env.local`; no request was made |
| Provider rejects a request | Check the provider dashboard for API credits, model access, and key scope |
| Generation request timed out | Inspect provider history and the local request record before resubmitting; the server may still be working |
| Fetch says not completed | Check the same job later; fetch never starts another generation |
| Download fails | Re-fetch the completed job to obtain a fresh asset URL |
| Imported model is absent | Check manifest path, GLB extensions, browser network errors, and decoder access |
| Generated room is absent | Set `world.enabled` after checking its transform and ensuring both URLs exist |
| Character is stuck after world import | Disable the world, recalibrate the shared collider/splat transform and spawn, then retry |
| Cloud save falls back to local | Check `VITE_CONVEX_URL`, run `npx convex dev`, and restart Vite |

If you need a reliable demo immediately, leave the world disabled and use the authored facility. Generated assets can be added one at a time without changing the incident mechanics.
