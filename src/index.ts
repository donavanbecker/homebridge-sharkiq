import type { API } from 'homebridge'

import { SharkIQMatterPlatform } from './SharkIQMatterPlatform.js'
import { SharkIQPlatform } from './platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import { createPlatformProxy } from './utils.js'

// Register our platform with homebridge.
// The proxy selects between the Matter platform (Homebridge v2.0+) and the
// standard HAP platform at runtime based on config and API availability.
export default (api: API): void => {
  const ProxyCtor = createPlatformProxy(SharkIQPlatform, SharkIQMatterPlatform)
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ProxyCtor)
}
