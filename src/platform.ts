import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  MatterAccessory,
  PlatformConfig,
  SerializedMatterAccessory,
} from 'homebridge'

import { join } from 'node:path'

import {
  RoboticVacuumAccessory,
} from './devices/index.js'
import { Login } from './login.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import { get_ayla_api } from './sharkiq-js/ayla_api.js'
import { global_vars } from './sharkiq-js/const.js'

/**
 * MatterPlatform
 * Demonstrates all available Matter device types in Homebridge
 *
 * Organized by official Matter Specification v1.4.1 categories
 */
export class SharkIQPlatform implements DynamicPlatformPlugin {
  // Track restored HAP cached accessories (required for DynamicPlatformPlugin)
  // This is commented out here as this plugin does not have any HAP accessories
  // public readonly accessories: Map<string, PlatformAccessory> = new Map()

  // Track restored Matter cached accessories
  // Can contain either the serialized object restored from disk or a runtime Platform/MatterAccessory
  public readonly matterAccessories: Map<string, SerializedMatterAccessory | MatterAccessory> = new Map()
  // Device vacuums object array (typed as any[] to avoid import-order issues)
  public vacuumDevices: any[] = []

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name)

    // Does the user have a version of Homebridge that is compatible with matter?
    if (!this.api.isMatterAvailable?.()) {
      this.log.warn('Matter is not available in this version of Homebridge. Please update Homebridge to use this plugin.')
    }

    // Check if the user has matter enabled, this means:
    // - If the plugin is running on the main bridge, then the user must have enabled matter in the Homebridge settings page in the UI
    // - If the plugin is running on a child bridge, then the user must have enabled matter on the plugin bridge settings section in the UI
    // In reality, only the below check is needed, but they are both included here for completeness
    // Remember to use a '?.' optional chaining operator in case the user is running an older version of Homebridge that does not have these APIs
    if (!this.api.isMatterEnabled?.()) {
      this.log.warn('Matter is not enabled in Homebridge. Please enable Matter in the Homebridge settings to use this plugin.')
      return
    }

    // Register Matter accessories when Homebridge has finished launching
    this.api.on('didFinishLaunching', async () => {
      this.log.debug('Executed didFinishLaunching callback')
      try {
        // Attempt to login and populate this.vacuumDevices if configured
        await this.login()
      } catch (error) {
        this.log.error('Error logging in to Shark API:', error)
      }

      await this.registerMatterAccessories()
    })
  }

  // Attempt to login and fetch devices.
  login = async (): Promise<void> => {
    const serialNumbers = this.config.vacuums
    // If no DSNs provided, we'll dynamically use all devices from the Shark API
    const useAllDevices = !Array.isArray(serialNumbers) || serialNumbers.length === 0
    if (useAllDevices) {
      this.log.info('No DSNs provided in config — will add all Shark devices from your account')
    }

    const europe = this.config.europe || false
    const storagePath = this.api.user.storagePath()
    const auth_file = join(storagePath, global_vars.FILE)
    const oauth_file = join(storagePath, global_vars.OAUTH.FILE)
    const oAuthCode = this.config.oAuthCode || ''
    const email = this.config.email || ''
    const password = this.config.password || ''

    if (email !== '' && password === '') {
      throw new Error('Password must be present in the config if email is provided.')
    } else if (email === '' && password !== '') {
      throw new Error('Email must be present in the config if password is provided.')
    }

    const login = new Login(this.log, auth_file, oauth_file, email, password, oAuthCode, europe)
    await login.checkLogin()
    const ayla_api = get_ayla_api(auth_file, this.log, europe)
    await ayla_api.sign_in()
    const devices = await ayla_api.get_devices()

    // Filter devices by DSNs provided in config, or take all devices when none specified
    for (let i = 0; i < devices.length; i++) {
      const dsn = devices[i].serial_number
      if (useAllDevices || (Array.isArray(serialNumbers) && serialNumbers.includes(dsn))) {
        this.vacuumDevices.push(devices[i])
      }
    }
    if (this.vacuumDevices.length === 0) {
      if (useAllDevices) {
        this.log.warn('No Shark devices were found on your account.')
      } else {
        this.log.warn('None of the DSNs provided matched the vacuum(s) on your account.')
      }
    } else {
      this.log.info(`Discovered ${this.vacuumDevices.length} Shark device(s) from your account.`)
    }
  }

  /**
   * Required for DynamicPlatformPlugin
   * Called when homebridge restores cached accessories from disk at startup
   */
  configureAccessory(/* accessory: PlatformAccessory */) {
    // Note this is not used for Matter accessories - use configureMatterAccessory instead
    // This plugin does not have any hap accessories, so here we can comment this out
    // this.accessories.set(accessory.UUID, accessory)
  }

  /**
   * Called when homebridge restores cached Matter accessories from disk at startup.
   *
   * This is where you can access the `accessory.context` object to retrieve
   * any custom data you stored when the accessory was originally registered.
   */
  configureMatterAccessory(accessory: SerializedMatterAccessory) {
    this.log.debug('Loading cached Matter accessory:', accessory.displayName)
    // store the serialized accessory; later code may replace this with a runtime MatterAccessory instance
    this.matterAccessories.set(accessory.uuid, accessory)
  }

  /**
   * Register all Matter accessories
   */
  private async registerMatterAccessories() {
    // Remove accessories that are disabled in config
    await this.removeDisabledAccessories()

    // Register devices by Matter specification sections
    await this.registerSection12Robotic()

    this.log.debug('Finished registering Matter accessories')
  }

  /**
   * Remove accessories that are disabled in config
   */
  private async removeDisabledAccessories() {
    const configMap = [
      { enabled: this.config.enableRobotVacuum, uuid: this.api.matter.uuid.generate('matter-robot-vacuum'), name: 'Robot Vacuum' },
    ]

    for (const { enabled, uuid, name } of configMap) {
      if (enabled === false) {
        const existingAccessory = this.matterAccessories.get(uuid)
        if (existingAccessory) {
          this.log.info(`Removing accessory '${name}' (disabled in config)`)
          await this.api.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory as unknown as MatterAccessory])
          this.matterAccessories.delete(uuid)
        }
      }
    }
  }

  /**
   * Section 12: Robotic Devices (Matter Spec § 12)
   * ⚠️ IMPORTANT: RVC devices use a DIFFERENT PROCESS (same code) than other devices!
   * When this runs, you'll see separate commissioning codes in the logs for the robot vacuum.
   * Use those codes to pair the vacuum as a separate bridge in your Home app.
   */
  private async registerSection12Robotic() {
    const accessories: MatterAccessory[] = []

    // Compute poll interval (ms) from config (seconds)
    const pollIntervalSec = typeof this.config.pollInterval === 'number' ? this.config.pollInterval : 30
    const pollIntervalMs = Math.max(0, Math.floor(pollIntervalSec * 1000))

    // Robot Vacuum
    if (this.config.enableRobotVacuum !== false) {
      // Determine DSNs we discovered (from API)
      const discoveredDsns = Array.isArray(this.vacuumDevices)
        ? this.vacuumDevices.map(d => (d && (d.serial_number || d._dsn))?.toString()).filter(Boolean)
        : []

      // Register one accessory per discovered Shark device (skip registration if restored from cache)
      if (discoveredDsns.length > 0) {
        for (const sharkDevice of this.vacuumDevices) {
          const dsn = (sharkDevice && (sharkDevice.serial_number || sharkDevice._dsn))
          const deviceUuid = this.api.matter.uuid.generate(dsn?.toString() || 'matter-robot-vacuum')

          if (this.matterAccessories.has(deviceUuid)) {
            this.log.debug(`Accessory for DSN ${dsn} already restored from cache; skipping new registration.`)
            continue
          }

          const device = new RoboticVacuumAccessory(this.api, this.log, sharkDevice, pollIntervalMs)
          accessories.push(device.toAccessory())
          // Keep runtime instance so we can manage lifecycle (stop polling) if needed
          this.matterAccessories.set(device.uuid, device)
        }
      } else {
        // Fallback to demo accessory when no Shark devices are available
        const demoUuid = this.api.matter.uuid.generate('VACUUM-001')
        if (!this.matterAccessories.has(demoUuid)) {
          const device = new RoboticVacuumAccessory(this.api, this.log, undefined, pollIntervalMs)
          accessories.push(device.toAccessory())
          this.matterAccessories.set(device.uuid, device)
        }
      }
    }

    // Unregister cached accessories that are no longer present in discovered devices or config
    try {
      const allowedDsns = (Array.isArray(this.vacuumDevices) && this.vacuumDevices.length > 0)
        ? this.vacuumDevices.map(d => (d && (d.serial_number || d._dsn))?.toString()).filter(Boolean)
        : (Array.isArray(this.config.vacuums) ? this.config.vacuums.map(String) : [])

      const toUnregister: SerializedMatterAccessory[] = []
      for (const [, serialized] of this.matterAccessories) {
        try {
          const ser = serialized as SerializedMatterAccessory
          const svrDsn = ser.context?.serialNumber || ser.context?.serialnumber || ser.context?.serial
          if (svrDsn && allowedDsns.length > 0 && !allowedDsns.includes(String(svrDsn))) {
            toUnregister.push(ser)
          }
        } catch {
          // ignore malformed cached accessory
        }
      }

      if (toUnregister.length > 0) {
        this.log.info(`Removing ${toUnregister.length} cached Matter accessory(ies) that are not in the discovered list`)
        await this.api.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toUnregister as unknown as MatterAccessory[])
        for (const acc of toUnregister) {
          // If we have a runtime instance, stop any polling or background tasks first
          try {
            const runtime = this.matterAccessories.get(acc.uuid) as any
            if (runtime && typeof runtime.stopPolling === 'function') {
              runtime.stopPolling()
            }
          } catch {
            // ignore
          }
          this.matterAccessories.delete(acc.uuid)
        }
      }
    } catch (e) {
      this.log.debug('Error while unregistering stale accessories:', e)
    }

    if (accessories.length > 0) {
      this.log.info(`✓ Registered ${accessories.length} robot vacuum device(s)`)
      for (const acc of accessories) {
        this.log.info(`  - ${acc.displayName} (standalone for Apple Home compatibility)`)
      }
      await this.api.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessories)
    }
  }
}
