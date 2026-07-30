import type { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge'

import type { SharkIqVacuum } from './sharkiq-js/sharkiq.js'

import { TIMEOUTS } from './constants.js'
import { createPromiseRejectionHandler } from './errorHandling.js'
import { SharkIQPlatform } from './platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import { areaIdsToRoomNames, buildServiceAreaCluster, isKnownCleanMode, MATTER_CLEAN_MODES, matterOperationalError, matterPowerSourceState, OperatingModes, Properties } from './sharkiq-js/sharkiq.js'

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
            // Battery, so Home shows a charge level and warns when it is low (#88).
            powerSource: matterPowerSourceState(vacuumDevice.battery()),
            // Suction level. Previously only reachable on HAP, where it is a fan
            // speed slider - Matter users had no way to change it at all (#88).
            rvcCleanMode: {
              supportedModes: [...MATTER_CLEAN_MODES],
              currentMode: vacuumDevice.power_mode() ?? 0,
            },
            // ServiceArea: room selection, from the vacuum's own map (#41). Only
            // declared when the vacuum reports a room list - advertising an empty
            // area list would give a controller a picker with nothing in it.
            ...(vacuumDevice.get_room_list?.()?.length
              ? { serviceArea: buildServiceAreaCluster(vacuumDevice.get_room_list()) }
              : {}),
            rvcOperationalState: {
              // operationalStateLabel is only permitted on manufacturer-specific
              // states (IDs 128-191). Matter.js rejects it on the standard states
              // below (0-66) as a conformance error and rolls back the whole
              // registration (#83), so only the IDs are supplied. The list must
              // still include the Error state (id 3) or the server also rolls back
              // (#79).
              operationalStateList: [
                { operationalStateId: 0 },
                { operationalStateId: 1 },
                { operationalStateId: 2 },
                { operationalStateId: 3 },
                { operationalStateId: 64 },
                { operationalStateId: 65 },
                { operationalStateId: 66 },
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
   * Two clusters carry the control commands, and different controllers use
   * different ones:
   *
   * - `rvcRunMode.changeToMode` - switching between the Idle and Cleaning modes.
   * - `rvcOperationalState.pause` / `resume` / `goHome` - Apple Home's tile uses
   *   these. Its play button sends `resume`, its pause button `pause`, and the
   *   dock button `goHome`. Without handlers for them the plugin returned
   *   `UnsupportedCommand` and the vacuum never moved (#68).
   *
   * `resume` maps to a fresh start when the vacuum is docked or idle, and to a
   * plain resume-in-place when it is already paused mid-clean.
   */
  private _buildMatterHandlers(_matterApi: any, _uuid: string, vacuumDevice: SharkIqVacuum): Record<string, unknown> {
    // Rooms the controller has selected, as area ids. Held here rather than read
    // back from the cluster so a clean uses whatever was chosen most recently,
    // and cleared once used so the next plain "start" is a whole-house clean
    // again rather than silently repeating the last room.
    let selectedAreaIds: number[] = []

    const startCleaning = () => {
      const rooms = areaIdsToRoomNames(selectedAreaIds, vacuumDevice.get_room_list?.() ?? [])
      selectedAreaIds = []
      if (rooms.length > 0) {
        this.log.info(`Matter asked for a clean of: ${rooms.join(', ')}`)
      }
      // An empty list means a whole-house clean. It must stay empty rather than
      // becoming an empty area filter - that is what stopped the vacuum leaving
      // the dock in #68.
      return vacuumDevice.clean_rooms(rooms)
        .catch(createPromiseRejectionHandler(this.log, 'Matter start cleaning'))
    }
    const returnToDock = () => vacuumDevice.cancel_clean()
      .catch(createPromiseRejectionHandler(this.log, 'Matter return to dock'))

    return {
      rvcRunMode: {
        changeToMode: async ({ newMode }: { newMode: number }) => {
          if (newMode === 1) {
            await startCleaning()
          } else {
            await returnToDock()
          }
        },
      },
      rvcCleanMode: {
        changeToMode: async ({ newMode }: { newMode: number }) => {
          if (!isKnownCleanMode(newMode)) {
            this.log.warn(`Matter asked for clean mode ${newMode}, which this vacuum does not have - ignoring.`)
            return
          }
          const label = MATTER_CLEAN_MODES.find(m => m.mode === newMode)?.label ?? String(newMode)
          this.log.info(`Matter set the suction level to ${label}.`)
          await vacuumDevice.set_property_value(Properties.POWER_MODE, newMode)
            .catch(createPromiseRejectionHandler(this.log, 'Matter set clean mode'))
        },
      },
      serviceArea: {
        selectAreas: async ({ newAreas }: { newAreas: number[] }) => {
          const rooms = vacuumDevice.get_room_list?.() ?? []
          const names = areaIdsToRoomNames(newAreas ?? [], rooms)
          if ((newAreas ?? []).length > 0 && names.length === 0) {
            // Every id was unrecognised, most likely a stale selection from a
            // renamed or reordered map. Say so rather than quietly cleaning
            // the whole house when the user asked for one room.
            this.log.warn(`Matter selected area(s) ${(newAreas ?? []).join(', ')} which are not on this vacuum's map - ignoring the selection.`)
            selectedAreaIds = []
            return
          }
          selectedAreaIds = newAreas ?? []
          this.log.debug(`Matter selected area(s): ${names.join(', ') || 'none'}`)
        },
        skipArea: async () => {
          // Skipping the area in progress is not something the Shark API exposes.
          this.log.debug('Matter asked to skip the current area, which this vacuum does not support.')
        },
      },
      rvcOperationalState: {
        resume: async () => {
          // Resume in place if a clean is paused, otherwise start a fresh clean
          if (vacuumDevice.operating_mode() === OperatingModes.PAUSE) {
            await vacuumDevice.set_operating_mode(OperatingModes.START)
              .catch(createPromiseRejectionHandler(this.log, 'Matter resume cleaning'))
          } else {
            await startCleaning()
          }
        },
        pause: async () => {
          await vacuumDevice.set_operating_mode(OperatingModes.PAUSE)
            .catch(createPromiseRejectionHandler(this.log, 'Matter pause cleaning'))
        },
        goHome: async () => {
          await returnToDock()
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
        await vacuumDevice.update([
          Properties.DOCKED_STATUS,
          Properties.OPERATING_MODE,
          Properties.POWER_MODE,
          Properties.BATTERY_CAPACITY,
          Properties.CHARGING_STATUS,
          // ⚠️ An attribute that is never fetched stays at its default forever,
          // so anything pushed to Matter below has to be listed here too (#88).
          Properties.ERROR_CODE,
          Properties.EXTENDED_ERROR_CODE,
          Properties.WATER_TANK_INSTALLED,
          Properties.WATER_TANK_EMPTY,
          Properties.MOP_PLATE_ATTACHED,
        ])

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

        // Faults and an empty water tank, as Matter's own error states (#88).
        const fault = vacuumDevice.fault()
        const waterTank = vacuumDevice.water_tank()
        const operationalError = matterOperationalError(fault, waterTank, mode === OperatingModes.START)

        if (typeof matterApi.updateAccessoryState === 'function') {
          await matterApi.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: runMode })
          // ⚠️ Order matters. matter.js forces the state to Error whenever an
          // error is set, and clears the error whenever the state moves away
          // from Error. Setting the state first and the error second lets a real
          // fault take precedence over "Docked", and lets a cleared fault fall
          // back to the true state.
          await matterApi.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState })
          await matterApi.updateAccessoryState(uuid, 'rvcOperationalState', { operationalError })
        }

        // Battery and suction level, so Home reflects what the vacuum reports
        // rather than only what we last told it (#88).
        const battery = vacuumDevice.battery()
        await matterApi.updateAccessoryState(uuid, 'powerSource', matterPowerSourceState(battery))
        const cleanMode = vacuumDevice.power_mode()
        if (isKnownCleanMode(cleanMode)) {
          await matterApi.updateAccessoryState(uuid, 'rvcCleanMode', { currentMode: cleanMode })
        }

        if (fault) {
          this.log.warn(`${vacuumDevice._name}: ${fault.message}${fault.extendedCode ? ` (extended code ${fault.extendedCode})` : ''}`)
        }

        this.log.debug(`[Matter] Vacuum ${vacuumDevice._dsn}: runMode=${runMode}, operationalState=${operationalState}, `
          + `battery=${battery.percent ?? 'unknown'}%${battery.charging ? ' (charging)' : ''}, cleanMode=${cleanMode}, `
          + `errorState=${operationalError.errorStateId}`)
        this.log.debug(
          '[Matter] Error code:',
          fault?.code ?? 0,
          '| Water tank installed:',
          waterTank.installed ?? 'not reported',
          'empty:',
          waterTank.empty ?? 'not reported',
          '| Mop plate attached:',
          vacuumDevice.mop_plate_attached() ?? 'not reported',
        )
      } catch (error) {
        this.log.debug('Failed to update Matter vacuum state:', error)
      }
    }

    // Initial fetch, then periodic
    void updateMatterState()
    setInterval(() => void updateMatterState(), dockedUpdateInterval)
  }
}
