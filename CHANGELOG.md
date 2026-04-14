# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/)

## [1.4.0](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.4.0) (2025-07-17)

### What's Changes
- Convert to ESModule
- Fix JSON parsing errors in SharkIQ API responses [#44](https://github.com/homebridge-plugins/homebridge-sharkiq/pull/44) [@mmenanno](https://github.com/mmenanno)
- Housekeeping and updated dependencies.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.3.2...v1.4.0

# ## [1.3.2](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.3.2) (2024-10-29)

### What's Changed
- Show warning messages if manual login is required

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.3.1...v1.3.2

# ## [1.3.1](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.3.1) (2024-09-29)

### What's Changed
- Development by [@Bubba8291](https://github.com/Bubba8291) in [#21](https://github.com/homebridge-plugins/homebridge-sharkiq/pull/21)
- Email and password login working again [#18](https://github.com/homebridge-plugins/homebridge-sharkiq/issues/18)
- Manual login still works as well
- Homebridge 2.0 support [#22](https://github.com/homebridge-plugins/homebridge-sharkiq/issues/22)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.2.3...v1.3.1

# ## [1.2.3](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.2.3) (2024-08-28)

### What's Changed
- Fixed the small chance of get fan speed generating errors
- Stores the date of the expiration rather than the amount of seconds until the auth token expiration ([#18](https://github.com/homebridge-plugins/homebridge-sharkiq/issues/18))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.2.2...v1.2.3

# ## [1.2.2](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.2.2) (2024-08-24)

### What's Changed
- Log location of auth file to user if errors relating to refresh continue

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.2.1...v1.2.2

# ## [1.2.1](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.2.1) (2024-08-24)

### What's Changed
- Added specific debug error messages from API

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.2.0...v1.2.1

# ## [1.2.0](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.2.0) (2024-08-19)

### What's Changed
- Switched to new Shark login method [#17](https://github.com/homebridge-plugins/homebridge-sharkiq/issues/17)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.1.3...v1.2.0

# ## [1.1.3](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.1.3) (2024-08-10)

### What's Changed
- Make API errors more descriptive

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.1.2...v1.1.3

# ## [1.1.2](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.1.2) (2023-10-27)

### What's Changed
- Vacuums are now obtained from their device serial numbers (DSN)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.1.1...v1.1.2

# ## [1.1.1](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.1.1) (2023-10-25)

### What's Changed
- Added support for the SharkClean European server

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.1.0...v1.1.1

# ## [1.1.0](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.1.0) (2023-10-09)

### What's Changed
- Fixed an issue where the plugin would slow down Homebridge [#8](https://github.com/homebridge-plugins/homebridge-sharkiq/issues/8)
- Changed the http client to `node-fetch`
- Fixed an issue where the vacuum states would not consistently update in Homebridge if controlled from the SharkClean mobile app
- Heavily optimized the plugin code
- Added a config option to change the interval on how often the docked status updates
- Changed the minimum Homebridge version to `1.6.1` [#9](https://github.com/homebridge-plugins/homebridge-sharkiq/pull/9)
- Updated the plugin to work on both Node versions 18 and 20 [#9](https://github.com/homebridge-plugins/homebridge-sharkiq/pull/9)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.0.9...v1.1.0

# ## [1.0.9](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.0.9) (2023-09-01)

### What's Changed
- Optimized code for parsing config

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.0.8...v1.0.9

# ## [1.0.8](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.0.8) (2023-09-01)

### What's Changed
- Updated README to include badge
- Added donation link

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.0.7...v1.0.8

# ## [1.0.7](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.0.7) (2023-09-01)

### What's Changed
- Updated `README`

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.0.6...v1.0.7

# ## [1.0.6](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.0.6) (2023-09-01)

### What's Changed
- Updated the README to make the json config easier to understand
- Updated the `config.schema.json` to fix a bug in the Homebridge config UI
- Updated `package.json` and removed a dev dependency that is no longer needed

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.0.5...v1.0.6

# ## [1.0.5](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.0.5) (2023-08-31)

### What's Changed
- Minor fixes and improvements to config and documentation

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.0.4...v1.0.5

# ## [1.0.4](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.0.4) (2023-08-30)

### What's Changed
- Added invert docked status option
- Bug fixes for auth token

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.0.3...v1.0.4

# ## [1.0.3](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.0.3) (2023-08-29)

### What's Changed
- Various bug fixes and documentation updates

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.0.2...v1.0.3

# ## [1.0.2](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.0.2) (2023-08-28)

### What's Changed
- Minor updates to config and formatting

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/v1.0.1...v1.0.2

# ## [1.0.1](https://github.com/homebridge-plugins/homebridge-sharkiq/releases/tag/v1.0.1) (2023-08-27)

### What's Changed
- Initial public release

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-sharkiq/compare/df61287...v1.0.1
