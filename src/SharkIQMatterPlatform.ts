import type { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge'

import type { SharkIqVacuum } from './sharkiq-js/sharkiq.js'

import { TIMEOUTS } from './constants.js'
import { createPromiseRejectionHandler } from './errorHandling.js'
import { SharkIQPlatform } from './platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import { OperatingModes, Properties } from './sharkiq-js/sharkiq.js'

/**
 * SharkIQMatterPlatform
 *
 * Extends the base HAP platform to add Homebridge v2.0 Matter support.
 * When the Homebridge Matter API is available and enabled, robot vacuums are
 * registered as native Matter `RoboticVacuumCleaner` endpoints via
 * `api.matter.registerPlatformAccessories()`. State is kept up-to-date by
 * periodic polling that calls `api.matter.updateAccessoryState()` directly —
 * no HAP platform accessories are created in the Matter code path, avoiding
 * duplicate accessories.
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
   * Called by Homebridge when a cached HAP accessory is restored from disk.
   *
   * Delegates to the parent so that `this.accessories` is populated for the
   * HAP fallback path. When Matter mode is active, these cached HAP accessories
   * are unregistered in `_cleanupCachedHapAccessories()` before Matter
   * accessories are registered, preventing duplicates.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    super.configureAccessory(accessory)
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
   * When the Matter API is fully initialised, cached HAP accessories are
   * cleaned up and vacuums are registered as Matter `RoboticVacuumCleaner`
   * accessories. Falls back to the standard HAP path when Matter is not available.
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

    this._cleanupCachedHapAccessories()
    this._registerMatterDevices(matterApi)
  }

  /**
   * Unregister all cached HAP accessories before registering Matter accessories.
   *
   * Prevents duplicate accessories when a user upgrades to Homebridge v2 or
   * switches from the HAP registration path to the Matter registration path.
   */
  private _cleanupCachedHapAccessories(): void {
    if (this.accessories.length === 0) {
      return
    }

    this.log.info(`Removing ${this.accessories.length} cached HAP accessor${this.accessories.length === 1 ? 'y' : 'ies'} before Matter registration.`)
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [...this.accessories])
    this.accessories.splice(0, this.accessories.length)
  }

  /**
   * Register all discovered vacuum devices using the Homebridge Matter API.
   *
   * For each vacuum:
   * - Reuses a previously cached `MatterAccessory` when the UUID matches, or
   *   creates a new plain-object descriptor satisfying the `MatterAccessory`
   *   interface.
   * - Starts a periodic polling loop that fetches live state from the Shark
   *   cloud and pushes updates directly via `api.matter.updateAccessoryState`.
   * - Removes any cached Matter accessories whose vacuums are no longer present.
   *
   * No HAP platform accessories are created in this path to avoid duplicate
   * device entries.
   */
  private _registerMatterDevices(matterApi: any): void {
    const accessoriesToRegister: any[] = []
    const activeMatterAccessories: any[] = []
    const cachedActiveMatterAccessories: any[] = []
    const unusedMatterAccessories = new Map(this.matterAccessories)

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
          handlers: this._buildMatterHandlers(matterApi, uuid, vacuumDevice),
        }
        accessoriesToRegister.push(matterAccessory)
        this.matterAccessories.set(uuid, matterAccessory)
        this.log.info(`Preparing new Matter accessory for vacuum: ${vacuumDevice._name.toString()} (${vacuumDevice._dsn})`)
      } else {
        cachedActiveMatterAccessories.push(matterAccessory)
        this.log.info(`Restoring cached Matter accessory for vacuum: ${vacuumDevice._name.toString()} (${vacuumDevice._dsn})`)
      }

      activeMatterAccessories.push(matterAccessory)

      // Start a polling loop to push live vacuum state into Matter cluster attributes
      this._startVacuumPolling(matterApi, uuid, vacuumDevice)
    })

    // Register new Matter accessories with Homebridge
    try {
      const externalAccessory = this.config.externalAccessory || false
      if (externalAccessory && typeof matterApi.publishExternalAccessories === 'function') {
        if (cachedActiveMatterAccessories.length > 0
          && typeof matterApi.unregisterPlatformAccessories === 'function') {
          this.log.info(`Unregistering ${cachedActiveMatterAccessories.length} bridged Matter accessory(ies) before external publishing.`)
          matterApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, cachedActiveMatterAccessories)
        }

        matterApi.publishExternalAccessories(PLUGIN_NAME, activeMatterAccessories)
        this.log.info(`Published ${activeMatterAccessories.length} Matter accessory(ies) as external device(s).`)
      } else if (accessoriesToRegister.length > 0) {
        matterApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRegister)
        this.log.info(`Registered ${accessoriesToRegister.length} Matter accessory(ies) with Homebridge.`)
      }
    } catch (error) {
      this.log.warn('Failed to register Matter accessories; falling back to HAP.', error)
      super.discoverDevices()
      return
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

  /**
   * Build Matter command handlers for an RVC accessory.
   *
   * Handlers respond to Matter `changeToMode` commands (user starting or
   * stopping the vacuum from a Matter controller or Apple Home) by calling
   * the appropriate SharkIQ API methods.
   */
  private _buildMatterHandlers(_matterApi: any, _uuid: string, vacuumDevice: SharkIqVacuum): Record<string, unknown> {
    return {
      rvcRunMode: {
        changeToMode: async ({ newMode }: { newMode: number }) => {
          if (newMode === 1) {
            // Start cleaning
            await vacuumDevice.clean_rooms([])
              .catch(createPromiseRejectionHandler(this.log, 'Matter start cleaning'))
          } else {
            // Return to dock / stop
            await vacuumDevice.cancel_clean()
              .catch(createPromiseRejectionHandler(this.log, 'Matter cancel cleaning'))
          }
        },
      },
    }
  }

  /**
   * Start a periodic polling loop that fetches live vacuum state from the Shark
   * cloud and pushes updates into Matter cluster attributes via
   * `api.matter.updateAccessoryState`.
   */
  private _startVacuumPolling(matterApi: any, uuid: string, vacuumDevice: SharkIqVacuum): void {
    const dockedUpdateInterval = this.config.dockedUpdateInterval || TIMEOUTS.DEFAULT_DOCKED_UPDATE_INTERVAL
    const invertDockedStatus = this.config.invertDockedStatus || false

    const updateMatterState = async () => {
      try {
        await vacuumDevice.update([Properties.DOCKED_STATUS, Properties.OPERATING_MODE])

        const mode = vacuumDevice.operating_mode()
        const dockedStatus = vacuumDevice.docked_status()
        const isActive = mode === OperatingModes.START || mode === OperatingModes.STOP
        const isPaused = mode === OperatingModes.STOP
        const isDocked = invertDockedStatus ? dockedStatus !== 1 : dockedStatus === 1

        let operationalState = 66 // Docked
        if (!isDocked) {
          if (!isActive) {
            operationalState = 0 // Stopped
          } else if (isPaused) {
            operationalState = 2 // Paused
          } else {
            operationalState = 1 // Running
          }
        }

        const runMode = isActive ? 1 : 0 // 1 = Cleaning, 0 = Idle

        if (typeof matterApi.updateAccessoryState === 'function') {
          await matterApi.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: runMode })
          await matterApi.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState })
        }

        this.log.debug(`[Matter] Vacuum ${vacuumDevice._dsn}: runMode=${runMode}, operationalState=${operationalState}`)
      } catch (error) {
        this.log.debug('Failed to update Matter vacuum state:', error)
      }
    }

    // Initial fetch, then periodic
    void updateMatterState()
    setInterval(() => void updateMatterState(), dockedUpdateInterval)
  }
}
