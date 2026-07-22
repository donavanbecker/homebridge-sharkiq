# Copilot instructions

Guidance for AI coding agents working in this repository. The fuller version of this document is [CLAUDE.md](../CLAUDE.md) at the repo root — keep the two in sync.

## Commands

- Build: `npm run build` (`rimraf ./dist` → `tsc` → copy plugin UI html). All steps are required for a working package.
- Lint: `npm run lint` (`eslint . --max-warnings=0`, CI fails on warnings); `npm run lint:fix` to autofix.
- Test: `npm test` (vitest, colocated `src/**/*.test.ts`).
- Local dev loop: `npm run watch` (rebuild + restart on changes; see `nodemon.json`).

## Key architecture facts

- Homebridge dynamic platform plugin (`platform: "SharkIQ"`) exposing Shark IQ robot vacuums via SharkNinja's cloud, which runs on the **Ayla Networks** IoT platform (US + EU regions, `europe` config flag).
- `src/index.ts` registers a runtime HAP/Matter proxy (`createPlatformProxy` in `src/utils.ts`); keep `api.matter?.…` / Matter calls optional-chained.
- The Ayla client is vendored in `src/sharkiq-js/` (`ayla_api.ts` session, `sharkiq.ts` device model, `properties.ts`/`const.ts` maps). `src/login.ts` does the region-aware OAuth sign-in (`src/config.ts`), persisting auth/OAuth token files. Request options use the global `RequestInit`/`fetch` types (tsc-validated; eslint `no-undef` disabled inline).
- `SharkIQAccessory` (`src/platformAccessory.ts`) exposes a Switch (start/stop clean), Fanv2 and a ContactSensor (docked, with an `invertDockedStatus` option).
- Log through the platform/accessory log helpers so user logging settings are respected.

## Conventions

- TypeScript ESM: relative imports need `.js` extensions.
- ESLint `@antfu/eslint-config`: single quotes, sorted imports, multi-line braces on guards; run `npm run lint:fix` before committing.
- `config.schema.json` must stay in sync with `SharkIQPluginConfig` in `src/settings.ts`.
- Licensed Apache-2.0 — keep the LICENSE and upstream attribution intact.
