# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/)

## [2.0.0] (https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v2.0.0) (2025-XX-XX)

### Breaking Changes
- This release is Matter-only. The plugin now publishes external Matter Robotic Vacuum Cleaner accessories and no longer publishes HAP platform accessories. If you need the legacy HAP behavior, continue using a pre-2.0 release or a branch that preserves the HAP path.
- Minimum required Homebridge: >= 2.0.0-alpha.28 (or later) with Matter support exposed via `api.matter`.

### What's Changed
- Converted plugin to Matter-only and added Matter external accessory publishing for Robotic Vacuum Cleaner devices.
- Added lifecycle wiring so accessories wait for READY before initial sync and polling.
- Added retry/backoff for critical Ayla API calls.
- Removed HAP-specific configuration options (invertDockedStatus, dockedUpdateInterval, enhancedVacuumMode).

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.4.1...v2.0.0

## [1.4.1] (https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.4.1) (2025-XX-XX)

### What's Changed
- Fix ARM64 OAuth code handling for users with both email/password and OAuth code [#54](https://github.com/homebridge-plugins/homebridge-sharkiq/issues/54)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.4.0...v1.4.1

## [1.4.0](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.4.0) (2025-07-17)

### What's Changes
- Convert to ESModule
- Fix JSON parsing errors in SharkIQ API responses [#44](https://github.com/homebridge-plugins/homebridge-sharkiq/pull/44) [@mmenanno](https://github.com/mmenanno)
- Housekeeping and updated dependencies.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.3.2...v1.4.0

