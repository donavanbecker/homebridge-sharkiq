import type { API, Logger, PlatformConfig } from 'homebridge'

import { SharkIQAccessory } from './platformAccessory.js'
import { SharkIQPlatform } from './platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import { TIMEOUTS } from './constants.js'

/**
 * SharkIQMatterPlatform
 *
 * Extends the base HAP platform to add Homebridge v2.0 Matter support.
 * When the Homebridge Matter API is available and enabled, robot vacuums are
 * registered as native Matter `RoboticVacuumCleaner` endpoints via
 * `api.matter.registerPlatformAccessories()`.
 *
 * If the Matter API is unavailable (e.g. running on Homebridge v1.x or Matter
 * is disabled by the user) the platform falls back transparently to the
 * standard HAP registration path inherited from {@link SharkIQPlatform}.
 */
export class SharkIQMatterPlatform extends SharkIQPlatform {
  // Track restored Matter cached accessories
  public readonly matterAccessories: Map<string, any> = new Map()

  constructor(
    log: Logger,
    config: PlatformConfig,
    api: API,
  ) {
    super(log, config, api)

    if (!(api as any).isMatterAvailable?.()) {
      this.log.warn('Matter is not available in this version of Homebridge. SharkIQ will use HAP accessories.')
    } else if (!(api as any).isMatterEnabled?.()) {
      this.log.warn('Matter is not enabled in Homebridge. SharkIQ will use HAP accessories.')
    } else {
      this.log.info('Homebridge Matter support detected. SharkIQ will register vacuums as Matter accessories.')
    }
  }

  /**
   * Called by Homebridge when a cached Matter accessory is restored from disk.
   * Required for Matter-enabled platforms (mirrors `configureAccessory` for HAP).
   */
  configureMatterAccessory(accessory: any): void {
    this.log.info('Loading cached Matter accessory:', accessory.displayName)
    this.matterAccessories.set(accessory.UUID, accessory)
  }

  /**
   * Override the HAP `discoverDevices` method.
   *
   * When the Matter API is fully initialised, vacuums are registered as
   * Matter `RoboticVacuumCleaner` accessories. State management (polling,
   * characteristic updates) is still handled by {@link SharkIQAccessory}
   * using a lightweight HAP platform-accessory whose services are exposed
   * through Homebridge's internal Matter bridge.
   *
   * Falls back to the standard HAP path when Matter is not available.
   */
  discoverDevices(): void {
    const matterApi = (this.api as any).matter
    const matterAvailable = !!(this.api as any).isMatterAvailable?.()
      && !!(this.api as any).isMatterEnabled?.()
      && !!matterApi
      && typeof matterApi.registerPlatformAccessories === 'function'

    if (!matterAvailable) {
      this.log.info('Matter API not available; falling back to HAP for SharkIQ device registration.')
      super.discoverDevices()
      return
    }

    this._registerMatterDevices(matterApi)
  }

  /**
   * Register all discovered vacuum devices using the Homebridge Matter API.
   *
   * For each vacuum:
   * - Reuse a previously cached `MatterAccessory` when the UUID matches, or
   *   create a new plain-object descriptor that satisfies the `MatterAccessory`
   *   interface.
   * - Still create a {@link SharkIQAccessory} backed by a HAP
   *   `PlatformAccessory` so that all existing polling/characteristic logic
   *   continues to work.  Homebridge's Matter bridge translates the HAP
   *   characteristics to Matter clusters automatically.
   * - Remove any cached accessories whose vacuums are no longer present.
   */
  private _registerMatterDevices(matterApi: any): void {
    const accessoriesToRegister: any[] = []
    const unusedMatterAccessories = new Map(this.matterAccessories)

    const invertDockedStatus = this.config.invertDockedStatus || false
    const dockedUpdateInterval = this.config.dockedUpdateInterval || TIMEOUTS.DEFAULT_DOCKED_UPDATE_INTERVAL

    this.vacuumDevices.forEach((vacuumDevice) => {
      const uuid = this.api.hap.uuid.generate(vacuumDevice._dsn.toString())

      // Remove from the "unused" tracking map now that we've seen it
      unusedMatterAccessories.delete(uuid)

      let matterAccessory = this.matterAccessories.get(uuid)

      if (!matterAccessory) {
        // Build a new MatterAccessory descriptor for this vacuum
        matterAccessory = {
          UUID: uuid,
          displayName: vacuumDevice._name.toString(),
          deviceType: matterApi.deviceTypes?.RoboticVacuumCleaner,
          serialNumber: vacuumDevice._dsn,
          manufacturer: 'Shark',
          model: vacuumDevice._vac_model_number || 'Unknown',
          firmwareRevision: '1.0.0',
          hardwareRevision: '1.0.0',
          context: { dsn: vacuumDevice._dsn },
          clusters: {
            rvcRunMode: {
              supportedModes: [
                { label: 'Idle', mode: 0, modeTags: [{ value: 16384 }] },
                { label: 'Cleaning', mode: 1, modeTags: [{ value: 16385 }] },
              ],
              currentMode: 0,
            },
            rvcOperationalState: {
              operationalStateList: [
                { operationalStateId: 0, operationalStateLabel: 'Stopped' },
                { operationalStateId: 1, operationalStateLabel: 'Running' },
                { operationalStateId: 2, operationalStateLabel: 'Paused' },
                { operationalStateId: 64, operationalStateLabel: 'Seeking Charger' },
                { operationalStateId: 65, operationalStateLabel: 'Charging' },
                { operationalStateId: 66, operationalStateLabel: 'Docked' },
              ],
              operationalState: 66,
            },
          },
        }
        accessoriesToRegister.push(matterAccessory)
        this.matterAccessories.set(uuid, matterAccessory)
        this.log.info(`Preparing new Matter accessory for vacuum: ${vacuumDevice._name} (${vacuumDevice._dsn})`)
      } else {
        this.log.info(`Restoring cached Matter accessory for vacuum: ${vacuumDevice._name} (${vacuumDevice._dsn})`)
      }

      // Create the underlying HAP platform accessory for state management.
      // The SharkIQAccessory uses HAP services/characteristics; Homebridge's
      // Matter bridge automatically converts those to Matter clusters.
      let hapAccessory = this.accessories.find(a => a.UUID === uuid)
      if (!hapAccessory) {
        hapAccessory = new this.api.platformAccessory(vacuumDevice._name.toString(), uuid)

        let accessoryInformationService = hapAccessory.getService(this.Service.AccessoryInformation)
        if (!accessoryInformationService) {
          accessoryInformationService = hapAccessory.addService(this.Service.AccessoryInformation)
        }
        accessoryInformationService
          .setCharacteristic(this.Characteristic.Manufacturer, 'Shark')
          .setCharacteristic(this.Characteristic.Model, vacuumDevice._vac_model_number || 'Unknown')
          .setCharacteristic(this.Characteristic.SerialNumber, vacuumDevice._dsn)
      }

      new SharkIQAccessory(this, hapAccessory, vacuumDevice, this.api.hap.uuid, this.log, invertDockedStatus, dockedUpdateInterval)
    })

    // Register new Matter accessories with Homebridge
    if (accessoriesToRegister.length > 0) {
      try {
        matterApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRegister)
        this.log.info(`Registered ${accessoriesToRegister.length} Matter accessory(ies) with Homebridge.`)
      } catch (error) {
        this.log.warn('Failed to register Matter accessories; falling back to HAP.', error)
        super.discoverDevices()
        return
      }
    }

    // Remove any Matter accessories whose vacuums are no longer in the config
    const toUnregister = [...unusedMatterAccessories.values()]
    toUnregister.forEach((unusedAccessory) => {
      this.log.info(`Removing unused Matter accessory: ${unusedAccessory.displayName}`)
      this.matterAccessories.delete(unusedAccessory.UUID)
    })

    if (toUnregister.length > 0) {
      try {
        matterApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toUnregister)
      } catch (error) {
        this.log.debug('Error unregistering stale Matter accessories:', error)
      }
    }
  }
}
