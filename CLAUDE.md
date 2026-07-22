# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — `rimraf ./dist && tsc && npm run plugin-ui`. The `plugin-ui` step rsyncs `src/homebridge-ui/public/index.html` into `dist/` (the custom settings UI). Skipping it produces a broken published package.
- `npm run lint` — ESLint over the whole repo with `--max-warnings=0`. CI fails on any warning. `npm run lint:fix` to autofix.
- `npm test` — vitest, colocated `src/**/*.test.ts` files.
- `npm run watch` — build, `npm link`, then `nodemon`: recompiles and restarts on `src/**/*.ts` changes (see `nodemon.json`).
- `npm run docs` — typedoc into `docs/` (gitignored — generated output is never committed).
- `npm run prepublishOnly` — lint then build; runs automatically on publish.

CI (`.github/workflows/build.yml`) runs install + lint on Node 22.x/24.x. Releases publish via `.github/workflows/release.yml`: a GitHub release (tag `vX.Y.Z`) publishes to npm's `latest` tag; pushes to `beta-X.Y.Z` / `alpha-X.Y.Z` branches publish incrementing prerelease versions to the `beta` / `alpha` tags.

Supported Node: `^22.12.0 || ^24.0.0`. Homebridge: `^1.11.4 || ^2.0.0`.

## Architecture

Homebridge dynamic platform plugin (`platform: "SharkIQ"`, package `@homebridge-plugins/homebridge-sharkiq`) exposing Shark IQ robot vacuums to HomeKit through SharkNinja's cloud, which runs on the **Ayla Networks** IoT platform. A US and an EU Ayla region are supported (`europe` config flag).

### HAP/Matter platform selection

`src/index.ts` registers a runtime proxy (`createPlatformProxy` in `src/utils.ts`) that instantiates `SharkIQMatterPlatform` (`src/SharkIQMatterPlatform.ts`) when Homebridge reports Matter available+enabled, otherwise the HAP `SharkIQPlatform` (`src/platform.ts`). Matter API calls must stay optional-chained.

### Ayla cloud client (`src/sharkiq-js/`)

The Ayla API client is vendored in-repo (no external dependency): `ayla_api.ts` handles the authenticated REST session, `sharkiq.ts` models a vacuum and its properties/commands, with `properties.ts` and `const.ts` holding the property map and endpoints. `src/login.ts` performs the OAuth sign-in (region-aware via `src/config.ts` / `generateURL`), persisting the auth and OAuth token files. `src/errorHandling.ts` centralises API-error classification. HTTP request options are typed with the global `RequestInit`/`fetch` types (tsc validates these; eslint's `no-undef` is disabled inline where they appear).

### Accessory (`src/platformAccessory.ts`)

`SharkIQAccessory` exposes a **Switch** (start/stop a clean), a **Fanv2** (running state / power), and a **ContactSensor** for the dock ("docked"), polling on `dockedUpdateInterval`. An `invertDockedStatus` option flips the contact sensor sense.

## Conventions

- TypeScript ESM (`"type": "module"`): relative imports use `.js` extensions even from `.ts` source.
- ESLint is `@antfu/eslint-config` (flat config in `eslint.config.js`): single quotes, 1tbs braces, `curly` multi-line only (single-line guards must use full multi-line braces), sorted imports. Run `npm run lint:fix` before committing.
- `config.schema.json` defines the Homebridge UI form and must stay in sync with `SharkIQPluginConfig` in `src/settings.ts`.
- Licensed Apache-2.0 — keep the LICENSE and upstream attribution intact.
