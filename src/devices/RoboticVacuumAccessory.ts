/* global NodeJS */

/**
 * Robotic Vacuum Cleaner Accessory Class
 *
 * This is a comprehensive example demonstrating all available features
 * of the RoboticVacuumCleaner device type including:
 * - Multiple run modes (Idle, Cleaning, Mapping)
 * - Multiple clean modes (Vacuum, Mop, Vacuum & Mop, Deep Clean)
 * - Operational state management with realistic transitions
 * - Service area (room) support
 *
 * IMPORTANT: Platform Matter accessories
 * =======================================
 * This vacuum is registered as a platform accessory using
 * api.matter.registerPlatformAccessories(), which works the same as HAP.
 * Platform accessories are registered synchronously and are immediately ready for use.
 *
 * Demo behavior:
 * - Start/Resume: Sets run mode to "Cleaning", runs for 15/10 seconds, then returns to dock
 * - Return to dock: Immediately sets "Idle" mode, then Seeking (5s) → Charging (3s) → Docked
 * - Stop: Immediately stops and resets to "Idle" mode
 * - Pause: Cancels automatic completion timer, keeps "Cleaning" mode
 */

import type { API, Logger, MatterRequests } from 'homebridge'

import type { SharkIqVacuum } from '../sharkiq-js/sharkiq.js'

import { ERROR_MESSAGES, OperatingModes, PowerModes, Properties } from '../sharkiq-js/properties.js'
import { BaseMatterAccessory } from './BaseMatterAccessory.js'

export class RoboticVacuumAccessory extends BaseMatterAccessory {
  private activeTimers: NodeJS.Timeout[] = []
  // Cache the last known run mode so we only emit info logs when it changes
  private lastRunMode: number | null = null
  // Use protected for battery/charging cache to match base class
  protected lastBatteryLevel: number | null = null
  protected lastChargingStatus: boolean | null = null
  // Cache operational state so we only emit info logs when it changes
  private lastOperationalState: number | null = null
  // Cache last seen RSSI so we only log when it changes
  private lastRssi: number | null = null
  // Cache last selected areas so we only emit info logs when selection changes
  private lastSelectedAreas: number[] | null = null
  // Cache last clean mode so we only emit info logs when it changes
  private lastCleanMode: number | null = null
  private readonly sharkDevice?: SharkIqVacuum
  private pollInterval?: NodeJS.Timeout

  constructor(api: API, log: Logger, sharkDevice?: SharkIqVacuum, pollIntervalMs?: number) {
    // If possible, initialize lastRunMode from the device or persisted state
    // This is done after super() returns so api and other properties are available.
    const serialNumber = (sharkDevice && ((sharkDevice as any).serial_number || (sharkDevice as any)._dsn)) || 'VACUUM-001'
    const displayName = (sharkDevice && ((sharkDevice as any).name || (sharkDevice as any)._name)) || 'Robot Vacuum'
    const manufacturer = sharkDevice ? 'Shark' : 'Homebridge Matter'
    const model = (sharkDevice && ((sharkDevice as any).vac_model_number || (sharkDevice as any)._vac_model_number)) || 'HB-MATTER-VACUUM-ROBOTIC'
    const firmwareRevision = (sharkDevice && ((sharkDevice as any)._firmware_version || 'unknown')) || '2.0.0'

    // Build serviceArea cluster from device rooms (local helper so we don't use `this` before super)
    const serviceAreaCluster = (() => {
      if (!sharkDevice || typeof (sharkDevice as any).get_room_list !== 'function') {
        return {
          supportedMaps: [],
          supportedAreas: [],
          selectedAreas: [],
        }
      }
      try {
        const rooms: string[] = (sharkDevice as any).get_room_list() || []
        const supportedAreas = rooms.map((roomName, idx) => ({
          areaId: idx,
          mapId: null,
          areaInfo: {
            locationInfo: {
              locationName: roomName,
              floorNumber: 0,
              areaType: 0,
            },
            landmarkInfo: null,
          },
        }))
        return {
          supportedMaps: [],
          supportedAreas,
          selectedAreas: supportedAreas.map(a => a.areaId),
        }
      } catch {
        return {
          supportedMaps: [],
          supportedAreas: [],
          selectedAreas: [],
        }
      }
    })()

    super(api, log, {
      uuid: api.matter.uuid.generate(serialNumber),
      displayName,
      deviceType: api.matter.deviceTypes.RoboticVacuumCleaner,
      serialNumber,
      manufacturer,
      model,
      firmwareRevision,
      hardwareRevision: '1.0.0',
      // Persist useful metadata in accessory.context so cached accessories retain DSN/model/etc.
      context: {
        serialNumber,
        name: displayName,
        vacModel: model,
        vacSerial: (sharkDevice && ((sharkDevice as any).vac_serial_number || (sharkDevice as any)._vac_serial_number)) || null,
        oemModel: (sharkDevice && ((sharkDevice as any).oem_model_number || (sharkDevice as any)._oem_model_number)) || null,
        pollIntervalMs: typeof pollIntervalMs === 'number' ? pollIntervalMs : null,
        // Cached runtime values persisted so they survive restarts
        lastRunMode: null,
        lastBatteryLevel: null,
        lastChargingStatus: null,
        lastOperationalState: null,
        lastRssi: null,
        lastSelectedAreas: null,
        lastCleanMode: null,
      },

      clusters: {
        // Run Mode: Controls what the vacuum is doing (Idle, Cleaning, Mapping)
        rvcRunMode: {
          supportedModes: [
            { label: 'Idle', mode: 0, modeTags: [{ value: 16384 }] }, // RvcRunMode.ModeTag.Idle
            { label: 'Cleaning', mode: 1, modeTags: [{ value: 16385 }] }, // RvcRunMode.ModeTag.Cleaning
            { label: 'Mapping', mode: 2, modeTags: [{ value: 16386 }] }, // RvcRunMode.ModeTag.Mapping
          ],
          currentMode: 0,
        },
        // Clean Mode: Controls HOW the vacuum cleans
        // You can combine semantic tags (0-9) with functional tags (16384-16386)
        // Available semantic tags: Auto, Quick, Quiet, LowNoise, LowEnergy, Vacation, Min, Max, Night, Day
        // Available functional tags: DeepClean, Vacuum, Mop
        rvcCleanMode: {
          supportedModes: [
            // Basic functional modes
            { label: 'Vacuum', mode: 0, modeTags: [{ value: 16385 }] }, // Vacuum
            { label: 'Mop', mode: 1, modeTags: [{ value: 16386 }] }, // Mop
            { label: 'Vacuum & Mop', mode: 2, modeTags: [{ value: 16385 }, { value: 16386 }] }, // Both

            // Deep clean modes
            { label: 'Deep Clean', mode: 3, modeTags: [{ value: 16384 }] }, // DeepClean
            { label: 'Deep Vacuum', mode: 4, modeTags: [{ value: 16384 }, { value: 16385 }] }, // DeepClean + Vacuum
            { label: 'Deep Mop', mode: 5, modeTags: [{ value: 16384 }, { value: 16386 }] }, // DeepClean + Mop

            // Intensity modes
            { label: 'Quick Clean', mode: 6, modeTags: [{ value: 1 }, { value: 16385 }] }, // Quick + Vacuum
            { label: 'Max Clean', mode: 7, modeTags: [{ value: 7 }, { value: 16385 }] }, // Max + Vacuum
            { label: 'Min Clean', mode: 8, modeTags: [{ value: 6 }, { value: 16385 }] }, // Min + Vacuum

            // Quiet modes
            { label: 'Quiet Vacuum', mode: 9, modeTags: [{ value: 2 }, { value: 16385 }] }, // Quiet + Vacuum
            { label: 'Quiet Mop', mode: 10, modeTags: [{ value: 2 }, { value: 16386 }] }, // Quiet + Mop
            { label: 'Night Mode', mode: 11, modeTags: [{ value: 8 }, { value: 16385 }] }, // Night + Vacuum

            // Energy efficient
            { label: 'Eco Vacuum', mode: 12, modeTags: [{ value: 4 }, { value: 16385 }] }, // LowEnergy + Vacuum
            { label: 'Eco Mop', mode: 13, modeTags: [{ value: 4 }, { value: 16386 }] }, // LowEnergy + Mop

            // Auto mode
            { label: 'Auto', mode: 14, modeTags: [{ value: 0 }, { value: 16385 }] }, // Auto + Vacuum
          ],
          currentMode: 0, // start with basic Vacuum
        },
        // Operational State: Current state (Stopped, Running, Paused, Error, etc.)
        rvcOperationalState: {
          operationalStateList: [
            { operationalStateId: 0 }, // stopped (standard label from Matter spec)
            { operationalStateId: 1 }, // running
            { operationalStateId: 2 }, // paused
            { operationalStateId: 3 }, // error
            { operationalStateId: 64 }, // seeking charger
            { operationalStateId: 65 }, // charging
            { operationalStateId: 66 }, // docked
          ],
          operationalState: 66, // start docked
        },
        // Service Area: Room/zone selection for targeted cleaning
        serviceArea: serviceAreaCluster,
        // Legacy informational clusters are intentionally NOT registered here.
        // updateState() will special-case 'power' and 'diagnostics' and
        // translate or skip updates when the accessory does not actually
        // support those clusters. Registering empty legacy clusters can
        // result in Behavior ID errors on Matter servers that don't expose
        // those behaviors, so we avoid adding them.
      },
      // Map legacy cluster names to supported clusters. This allows callers
      // that still use legacy names to be translated to the correct
      // cluster when appropriate. If the mapped target is not present on
      // the accessory, BaseMatterAccessory.updateState() will safely skip
      // or translate attributes instead of forwarding an update that
      // would cause a Behavior ID error on the Matter server.
      clusterNameMap: {
        power: 'rvcOperationalState',
        diagnostics: 'rvcOperationalState',
      },

      handlers: {
        rvcRunMode: {
          changeToMode: async (request: MatterRequests.ChangeToMode) => this.handleChangeRunMode(request),
        },
        rvcCleanMode: {
          changeToMode: async (request: MatterRequests.ChangeToMode) => this.handleChangeCleanMode(request),
        },
        rvcOperationalState: {
          pause: async () => this.handlePause(),
          stop: async () => this.handleStop(),
          start: async () => this.handleStart(),
          resume: async () => this.handleResume(),
          goHome: async () => this.handleGoHome(),
        },
        serviceArea: {
          selectAreas: async (request: MatterRequests.SelectAreas) => this.handleSelectAreas(request),
          skipArea: async (request: MatterRequests.SkipArea) => this.handleSkipArea(request),
        },
        // Note: battery/diagnostics updates are sent at runtime from polling via
        // updateState(). The previous implementation placed static objects under
        // `handlers` using non-standard cluster names ('power' / 'diagnostics'),
        // which can cause errors when those clusters are not supported by the
        // Matter server. We avoid registering invalid handlers here; runtime
        // updates will be guarded by BaseMatterAccessory.updateState().
      },
    })

    this.sharkDevice = sharkDevice

    // Start polling device state if we have a Shark device and polling is enabled
    if (this.sharkDevice && typeof pollIntervalMs === 'number' && pollIntervalMs > 0) {
      this.startPolling(pollIntervalMs)
    } else if (this.sharkDevice && (typeof pollIntervalMs !== 'number' || pollIntervalMs <= 0)) {
      // If pollIntervalMs is omitted, default to 30s
      if (typeof pollIntervalMs !== 'number') {
        this.startPolling()
      }
    }

    this.logInfo('initialized and ready.')
    // Initialize cached runtime values (device wrapper preferred; fallback to persisted accessory state)
    this.initCachedState(sharkDevice)
  }

  /**
   * Initialize cached runtime values from the Shark device wrapper where
   * available, otherwise fall back to persisted accessory state exposed by the API.
   */
  private initCachedState(sharkDevice?: SharkIqVacuum): void {
    try {
      // Prefer value from Shark device wrapper if available
      if (sharkDevice && typeof (sharkDevice as any).operating_mode === 'function') {
        const op = (sharkDevice as any).operating_mode()
        if (typeof op === 'number') {
          this.persistCache('lastRunMode', op, 'lastRunMode')
        }

        // battery
        if ((sharkDevice as any).battery_capacity && typeof (sharkDevice as any).battery_capacity === 'function') {
          const b = (sharkDevice as any).battery_capacity()
          if (typeof b === 'number') {
            this.persistCache('lastBatteryLevel', Number(b), 'lastBatteryLevel')
          }
        }

        // charging status
        if ((sharkDevice as any).charging_status && typeof (sharkDevice as any).charging_status === 'function') {
          const c = (sharkDevice as any).charging_status()
          if (typeof c !== 'undefined') {
            this.persistCache('lastChargingStatus', c === 1 || c === true, 'lastChargingStatus')
          }
        }

        // clean mode mapping
        if ((sharkDevice as any).power_mode && typeof (sharkDevice as any).power_mode === 'function') {
          try {
            const pm = (sharkDevice as any).power_mode()
            if (typeof pm === 'number') {
              let cleanMode = 0
              if (pm === PowerModes.ECO) {
                cleanMode = 12 // Eco Vacuum
              } else if (pm === PowerModes.MAX) {
                cleanMode = 7 // Max Clean
              }
              this.persistCache('lastCleanMode', cleanMode, 'lastCleanMode')
            }
          } catch {
            // ignore
          }
        }

        // docked/operational
        if ((sharkDevice as any).docked_status && typeof (sharkDevice as any).docked_status === 'function') {
          const d = (sharkDevice as any).docked_status()
          if (typeof d === 'number') {
            this.persistCache('lastOperationalState', d === 1 ? 66 : null, 'lastOperationalState')
          }
        }

        if (this.lastOperationalState === null && typeof op === 'number') {
          if (op === OperatingModes.START) {
            this.persistCache('lastOperationalState', 1, 'lastOperationalState')
          } else if (op === OperatingModes.PAUSE) {
            this.persistCache('lastOperationalState', 2, 'lastOperationalState')
          } else if (op === OperatingModes.RETURN) {
            this.persistCache('lastOperationalState', 64, 'lastOperationalState')
          } else if (op === OperatingModes.STOP) {
            this.persistCache('lastOperationalState', 0, 'lastOperationalState')
          }
        }

        // selected areas from device room list
        if (typeof (sharkDevice as any).get_room_list === 'function') {
          try {
            const rooms: string[] = (sharkDevice as any).get_room_list() || []
            const ids = rooms.map((_, idx) => idx)
            const sanitized = Array.from(new Set(ids.filter(n => Number.isInteger(n) && n >= 0 && n < rooms.length)))
            this.persistCache('lastSelectedAreas', sanitized, 'lastSelectedAreas')
          } catch {
            // ignore
          }
        }
      } else if ((this.api as any).matter && typeof (this.api as any).matter.getAccessoryState === 'function') {
        try {
          const state = (this.api as any).matter.getAccessoryState(this.uuid, 'rvcRunMode')
          if (state && typeof state.currentMode === 'number') {
            this.persistCache('lastRunMode', state.currentMode, 'lastRunMode')
          }

          // persisted power cluster
          try {
            const p = (this.api as any).matter.getAccessoryState(this.uuid, 'power')
            if (p) {
              if (typeof p.batteryLevel === 'number') {
                this.persistCache('lastBatteryLevel', Number(p.batteryLevel), 'lastBatteryLevel')
              }
              if (typeof p.charging !== 'undefined') {
                this.persistCache('lastChargingStatus', p.charging === 1 || p.charging === true, 'lastChargingStatus')
              }
            }
          } catch {
            // ignore
          }

          // persisted clean mode
          try {
            const c = (this.api as any).matter.getAccessoryState(this.uuid, 'rvcCleanMode')
            if (c && typeof c.currentMode === 'number') {
              this.persistCache('lastCleanMode', Number(c.currentMode), 'lastCleanMode')
            }
          } catch {
            // ignore
          }

          // persisted diagnostics (RSSI)
          try {
            const d = (this.api as any).matter.getAccessoryState(this.uuid, 'diagnostics')
            if (d && typeof d.rssi === 'number') {
              this.persistCache('lastRssi', Number(d.rssi), 'lastRssi')
            }
          } catch {
            // ignore
          }

          // persisted operational state
          try {
            const o = (this.api as any).matter.getAccessoryState(this.uuid, 'rvcOperationalState')
            if (o && typeof o.operationalState === 'number') {
              this.persistCache('lastOperationalState', Number(o.operationalState), 'lastOperationalState')
            }
          } catch {
            // ignore
          }

          // persisted selected areas
          try {
            const s = (this.api as any).matter.getAccessoryState(this.uuid, 'serviceArea')
            if (s && Array.isArray(s.selectedAreas)) {
              const raw = Array.isArray(s.selectedAreas) ? s.selectedAreas.map((v: any) => Number(v)).filter((n: number) => Number.isInteger(n) && n >= 0) : []
              const sanitized = raw.length > 0 ? Array.from(new Set(raw)) : null
              this.persistCache('lastSelectedAreas', sanitized, 'lastSelectedAreas')
            }
          } catch {
            // ignore
          }
        } catch {
          // ignore failures reading accessory state
        }
      }
    } catch (e) {
      // Ignore any initialization errors; keep caches as-is
    }
  }

  /**
   * Persist a named cache value into accessory context and keep in-memory copy.
   * This centralizes writes so callers only need to update the in-memory field
   * and call this to persist to Homebridge accessory.context.
   */
  private persistCache(key: string, value: any, inMemoryKey?: string): void {
    try {
      // Update in-memory cache if requested
      if (typeof inMemoryKey === 'string' && inMemoryKey.length > 0) {
        try {
          ;(this as any)[inMemoryKey] = value
        } catch (e) {
          // ignore failures to set in-memory field
        }
      }
      // Write value into this.context under the same key name
      ;(this.context as any)[key] = value
    } catch (e) {
      // Best-effort: ignore failures to persist context
    }
  }

  private startPolling(intervalMs = 30000) {
    if (this.pollInterval) {
      return
    }
    this.pollInterval = setInterval(async () => {
      try {
        // Request a full update
        await (this.sharkDevice as any).update([])

        // Update run/operating mode
        const opMode = (this.sharkDevice as any).operating_mode?.() ?? null
        const powerMode = (this.sharkDevice as any).power_mode?.() ?? null
        const docked = (this.sharkDevice as any).docked_status?.() ?? null

        // Map operating mode to Matter run/operational state
        if (docked !== null && docked === 1) {
          // Docked
          this.updateOperationalState(66)
          this.updateRunMode(0)
        } else if (opMode !== null) {
          if (opMode === OperatingModes.START) {
            this.updateRunMode(1)
            this.updateOperationalState(1)
          } else if (opMode === OperatingModes.PAUSE) {
            this.updateOperationalState(2)
            this.updateRunMode(1)
          } else if (opMode === OperatingModes.RETURN) {
            this.updateOperationalState(64)
            this.updateRunMode(0)
          } else if (opMode === OperatingModes.STOP) {
            this.updateOperationalState(0)
            this.updateRunMode(0)
          }
        }

        // Map power mode to clean mode (best-effort mapping)
        if (powerMode !== null) {
          let cleanMode = 0 // Vacuum
          if (powerMode === PowerModes.ECO) {
            cleanMode = 12 // Eco Vacuum
          } else if (powerMode === PowerModes.MAX) {
            cleanMode = 7 // Max Clean
          } else {
            cleanMode = 0
          }
          this.updateCleanMode(cleanMode)
        }

        // Update service areas selection from device room list
        if (typeof (this.sharkDevice as any).get_room_list === 'function') {
          const rooms: string[] = (this.sharkDevice as any).get_room_list() || []
          const ids = rooms.map((_, idx) => idx)
          this.updateSelectedAreas(ids)
        }

        // Update battery level, charging and diagnostics using upstream helpers when available
        try {
          // Prefer convenience properties if present on the wrapper
          let batteryVal: any = null
          let chargingVal: any = null
          let errVal: any = null
          let errText: string | null = null

          if ((this.sharkDevice as any).battery_capacity && typeof (this.sharkDevice as any).battery_capacity === 'function') {
            batteryVal = (this.sharkDevice as any).battery_capacity()
          } else if (typeof (this.sharkDevice as any).get_property_value === 'function') {
            batteryVal = (this.sharkDevice as any).get_property_value(Properties.BATTERY_CAPACITY)
          }

          if ((this.sharkDevice as any).charging_status && typeof (this.sharkDevice as any).charging_status === 'function') {
            chargingVal = (this.sharkDevice as any).charging_status()
          } else if (typeof (this.sharkDevice as any).get_property_value === 'function') {
            chargingVal = (this.sharkDevice as any).get_property_value(Properties.CHARGING_STATUS)
          }

          // Error code / text
          if ((this.sharkDevice as any).error_code !== undefined && typeof (this.sharkDevice as any).error_code === 'function') {
            errVal = (this.sharkDevice as any).error_code()
            if ((this.sharkDevice as any).error_text && typeof (this.sharkDevice as any).error_text === 'function') {
              errText = (this.sharkDevice as any).error_text()
            }
          } else if (typeof (this.sharkDevice as any).get_property_value === 'function') {
            errVal = (this.sharkDevice as any).get_property_value(Properties.ERROR_CODE)
          }

          if (batteryVal !== null && typeof batteryVal !== 'undefined') {
            const pct = Number(batteryVal) || 0
            // chargingVal may be boolean-like or numeric
            const isCharging = chargingVal === 1 || chargingVal === true
            // Update in-memory cache in base for log suppression
            this.lastBatteryLevel = pct
            this.lastChargingStatus = isCharging
            await this.updateState('power', { batteryLevel: Math.max(0, Math.min(100, pct)), charging: isCharging })
            this.logDebug(`battery updated: ${pct}% (charging: ${isCharging})`)
            // Only emit info logs when battery level or charging status actually changes
            if (this.lastBatteryLevel !== pct || this.lastChargingStatus !== isCharging) {
              this.logInfo(`battery level: ${pct}%, charging: ${isCharging}`)
              // Persist both in-memory and accessory.context via helper
              this.persistCache('lastBatteryLevel', pct, 'lastBatteryLevel')
              this.persistCache('lastChargingStatus', isCharging, 'lastChargingStatus')
            }
          }

          // RSSI (signal strength) mapping if available
          try {
            const rssi = (this.sharkDevice as any).get_property_value
              ? (this.sharkDevice as any).get_property_value(Properties.RSSI)
              : null
            if (rssi !== null && typeof rssi !== 'undefined') {
              const r = Number(rssi)
              await this.updateState('diagnostics', { ...(null as any), rssi: r })
              // Only log when RSSI value actually changes
              if (this.lastRssi !== r) {
                this.logInfo(`rssi updated: ${r}`)
                this.persistCache('lastRssi', r, 'lastRssi')
              } else {
                this.logDebug(`rssi unchanged: ${r}`)
              }
            }
          } catch (e) {
            // ignore
          }

          if (errVal && Number(errVal) > 0) {
            const errCode = Number(errVal)
            // Prefer human friendly text from device wrapper if provided
            const text = errText || (ERROR_MESSAGES as any)[errCode] || `Error ${errCode}`
            // Map severity: treat these as actionable errors (set operational state to Error)
            await this.updateState('diagnostics', { errorCode: errCode, errorText: text, severity: 'critical' })
            this.updateOperationalState(3) // Error
            this.logWarn(`device error: ${errCode} - ${text}`)
          } else if (errVal === 0 || errVal === null || typeof errVal === 'undefined') {
            await this.updateState('diagnostics', { errorCode: 0, errorText: '', severity: 'ok' })
          }

          // Clean complete mapping - if device reports a clean complete flag, reflect it
          try {
            const cleanComplete = (this.sharkDevice as any).get_property_value
              ? (this.sharkDevice as any).get_property_value(Properties.CLEAN_COMPLETE)
              : null
            if (cleanComplete === 1 || cleanComplete === true) {
              // When cleaning completes, set run mode to Idle and operational to Stopped
              this.updateRunMode(0)
              this.updateOperationalState(0)
              this.logInfo('clean complete reported by device - updating state to Idle/Stopped')
            }
          } catch (e) {
            // ignore
          }
        } catch (e) {
          this.logDebug('Error updating battery/diagnostics:', e)
        }
      } catch (e) {
        this.logError('Polling error for Shark device:', e)
      }
    }, intervalMs)
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = undefined
    }
  }

  // Helper to build serviceArea cluster from Shark device rooms
  private buildServiceAreaCluster(sharkDevice?: SharkIqVacuum) {
    if (!sharkDevice || typeof (sharkDevice as any).get_room_list !== 'function') {
      return {
        supportedMaps: [],
        supportedAreas: [],
        selectedAreas: [],
      }
    }

    try {
      const rooms: string[] = (sharkDevice as any).get_room_list() || []
      const supportedAreas = rooms.map((roomName, idx) => ({
        areaId: idx,
        mapId: null,
        areaInfo: {
          locationInfo: {
            locationName: roomName,
            floorNumber: 0,
            areaType: 0,
          },
          landmarkInfo: null,
        },
      }))
      return {
        supportedMaps: [],
        supportedAreas,
        selectedAreas: supportedAreas.map(a => a.areaId),
      }
    } catch (e) {
      return {
        supportedMaps: [],
        supportedAreas: [],
        selectedAreas: [],
      }
    }
  }

  private async handleChangeRunMode(request: MatterRequests.ChangeToMode): Promise<void> {
    this.logInfo(`ChangeToMode (run) request received: ${JSON.stringify(request)}`)
    const { newMode } = request
    const modeStr = ['Idle', 'Cleaning', 'Mapping'][newMode] || `Unknown (mode=${newMode})`
    this.logInfo(`changing run mode to: ${modeStr}`)
    if (this.sharkDevice) {
      try {
        if (newMode === 1) {
          await (this.sharkDevice as any).set_operating_mode(OperatingModes.START)
        } else if (newMode === 0) {
          await (this.sharkDevice as any).set_operating_mode(OperatingModes.STOP)
        } else if (newMode === 2) {
          // Mapping - treat as start for now
          await (this.sharkDevice as any).set_operating_mode(OperatingModes.START)
        }
      } catch (e) {
        this.logError('Error setting run mode on Shark device:', e)
      }
    }

    // Clear any existing timers
    this.clearTimers()

    if (newMode === 1) {
      // Switching to Cleaning mode - start the vacuum
      this.updateOperationalState(1) // Running

      // Simulate cleaning completion after 15 seconds
      const completionTimer = setTimeout(() => {
        this.logInfo('cleaning completed, returning to dock.')
        this.updateRunMode(0) // Set to Idle - cleaning session ending
        this.returnToDock()
      }, 15000)

      this.activeTimers.push(completionTimer)
    } else if (newMode === 0) {
      // Switching to Idle mode - return to dock
      this.returnToDock()
    } else if (newMode === 2) {
      // Switching to Mapping mode - start mapping
      this.updateOperationalState(1) // Running

      // Simulate mapping completion after 20 seconds
      const completionTimer = setTimeout(() => {
        this.logInfo('mapping completed, returning to dock.')
        this.returnToDock()
      }, 20000)

      this.activeTimers.push(completionTimer)
    }
  }

  private async handleChangeCleanMode(request: MatterRequests.ChangeToMode): Promise<void> {
    this.logInfo(`ChangeToMode (clean) request received: ${JSON.stringify(request)}`)
    const { newMode } = request
    const modes = [
      'Vacuum',
      'Mop',
      'Vacuum & Mop',
      'Deep Clean',
      'Deep Vacuum',
      'Deep Mop',
      'Quick Clean',
      'Max Clean',
      'Min Clean',
      'Quiet Vacuum',
      'Quiet Mop',
      'Night Mode',
      'Eco Vacuum',
      'Eco Mop',
      'Auto',
    ]
    const modeStr = modes[newMode] || `Unknown (mode=${newMode})`
    this.logInfo(`changing clean mode to: ${modeStr}`)
    if (this.sharkDevice) {
      // Shark API doesn't expose a direct clean-mode setter here; keep local state and log.
      this.logInfo('Clean mode change requested for Shark device (not implemented in API wrapper).')
    }
  }

  private async handlePause(): Promise<void> {
    this.logInfo('pausing.')
    if (this.sharkDevice) {
      try {
        await (this.sharkDevice as any).set_operating_mode(OperatingModes.PAUSE)
      } catch (e) {
        this.logError('Error pausing Shark device:', e)
      }
    }
    this.clearTimers() // Clear cleaning completion timer
    this.updateOperationalState(2) // Paused
  }

  private async handleStop(): Promise<void> {
    this.logInfo('stopping.')
    if (this.sharkDevice) {
      try {
        await (this.sharkDevice as any).set_operating_mode(OperatingModes.STOP)
      } catch (e) {
        this.logError('Error stopping Shark device:', e)
      }
    }
    this.clearTimers()
    this.updateRunMode(0) // Reset to Idle
    this.updateOperationalState(0) // Stopped
  }

  private async handleStart(): Promise<void> {
    this.logInfo('starting (via start command).')
    if (this.sharkDevice) {
      try {
        await (this.sharkDevice as any).set_operating_mode(OperatingModes.START)
      } catch (e) {
        this.logError('Error starting Shark device:', e)
      }
    }

    // Clear any existing timers
    this.clearTimers()

    this.updateRunMode(1) // Set to Cleaning mode - this will trigger the run mode handler logic
    this.updateOperationalState(1) // Running

    // Simulate cleaning completion after 15 seconds
    const completionTimer = setTimeout(() => {
      this.logInfo('cleaning completed, returning to dock.')
      this.updateRunMode(0) // Set to Idle - cleaning session ending
      this.returnToDock()
    }, 15000)

    this.activeTimers.push(completionTimer)
  }

  private async handleResume(): Promise<void> {
    this.logInfo('resuming.')
    if (this.sharkDevice) {
      try {
        await (this.sharkDevice as any).set_operating_mode(OperatingModes.START)
      } catch (e) {
        this.logError('Error resuming Shark device:', e)
      }
    }

    // Clear any existing timers
    this.clearTimers()

    this.updateRunMode(1) // Set to Cleaning mode
    this.updateOperationalState(1) // Running

    // Simulate cleaning completion after 10 seconds (shorter since resuming)
    const completionTimer = setTimeout(() => {
      this.logInfo('cleaning completed, returning to dock.')
      this.updateRunMode(0) // Set to Idle - cleaning session ending
      this.returnToDock()
    }, 10000)

    this.activeTimers.push(completionTimer)
  }

  private async handleGoHome(): Promise<void> {
    this.logInfo('goHome command received.')
    if (this.sharkDevice) {
      try {
        await (this.sharkDevice as any).set_operating_mode(OperatingModes.RETURN)
      } catch (e) {
        this.logError('Error sending Shark device home:', e)
      }
    }

    // Clear any existing timers
    this.clearTimers()

    // Defer state updates to ensure handler completes first
    setImmediate(() => {
      // Set to Idle mode since we're ending the cleaning session
      this.updateRunMode(0)

      // Initiate return to dock sequence
      this.returnToDock()
    })
  }

  private async handleSelectAreas(request: MatterRequests.SelectAreas): Promise<void> {
    this.logInfo(`SelectAreas request received: ${JSON.stringify(request)}`)
    const { newAreas } = request
    if (this.sharkDevice && typeof (this.sharkDevice as any).get_room_list === 'function') {
      try {
        const rooms: string[] = (this.sharkDevice as any).get_room_list() || []
        const selected = newAreas.map((id: number) => rooms[id]).filter(Boolean)
        this.logInfo(`selecting areas: ${selected.join(', ')}`)
        if (selected.length > 0) {
          await (this.sharkDevice as any).clean_rooms(selected)
        }
      } catch (e) {
        this.logError('Error selecting areas on Shark device:', e)
      }
    } else {
      const areaNames = newAreas.map((id: number) =>
        ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'][id] || `Area ${id}`,
      )
      this.logInfo(`selecting areas: ${areaNames.join(', ')}`)
    }
  }

  private async handleSkipArea(request: MatterRequests.SkipArea): Promise<void> {
    this.logInfo(`SkipArea request received: ${JSON.stringify(request)}`)
    const { skippedArea } = request
    const areaName = ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'][skippedArea] || `Area ${skippedArea}`
    this.logInfo(`skipping area: ${areaName}`)
    // Shark API does not provide skipArea; best-effort: log and leave running session intact.
  }

  /**
   * Helper method to clear all active timers
   */
  private clearTimers(): void {
    this.activeTimers.forEach(timer => clearTimeout(timer))
    this.activeTimers = []
  }

  /**
   * Helper method to initiate return to dock sequence
   * Can be called synchronously from other handlers
   */
  private returnToDock(): void {
    this.logInfo('initiating return to dock sequence.')

    // Defer ALL state updates to ensure handler completes first
    setImmediate(() => {
      // Start seeking charger directly (skip intermediate Stopped state)
      this.updateOperationalState(64) // Seeking Charger

      // After 5 seconds, start charging
      const chargingTimer = setTimeout(() => {
        this.logInfo('reached dock, now charging.')
        this.updateOperationalState(65) // Charging

        // After 3 more seconds, fully docked
        const dockedTimer = setTimeout(() => {
          this.logInfo('fully charged and docked.')
          this.updateOperationalState(66) // Docked
        }, 3000)

        this.activeTimers.push(dockedTimer)
      }, 5000)

      this.activeTimers.push(chargingTimer)
    })
  }

  /**
   * Update Methods - Use these to update the vacuum state from your API/device
   *
   * Since this is a platform accessory, state updates work immediately after registration.
   */

  public updateOperationalState(state: number): void {
    this.updateState('rvcOperationalState', { operationalState: state })
    const states = [
      'Stopped',
      'Running',
      'Paused',
      'Error',
      null,
      null,
      null,
      null,
      ...Array.from({ length: 56 }).fill(null),
      'Seeking Charger',
      'Charging',
      'Docked',
    ]

    // Only emit info logs when the operational state actually changes
    if (this.lastOperationalState !== state) {
      this.logInfo(`operational state updated to: ${states[state] || `Unknown (${state})`}`)
      this.lastOperationalState = state
      this.persistCache('lastOperationalState', state)
    } else {
      this.logDebug(`operational state unchanged: ${states[state] || `Unknown (${state})`}`)
    }
  }

  public updateRunMode(mode: number): void {
    this.updateState('rvcRunMode', { currentMode: mode })
    const modes = ['Idle', 'Cleaning', 'Mapping']
    this.logDebug(`run mode updated to: ${modes[mode] || `Unknown (${mode})`}`)

    // Only emit informational logs when the run mode actually changes
    if (this.lastRunMode !== mode) {
      if (mode === 0) {
        this.logInfo('vacuum is now idle.')
      } else if (mode === 1) {
        this.logInfo('vacuum is now cleaning.')
      } else if (mode === 2) {
        this.logInfo('vacuum is now mapping.')
      }
      this.lastRunMode = mode
      this.persistCache('lastRunMode', mode)
    }
  }

  public updateCleanMode(mode: number): void {
    this.updateState('rvcCleanMode', { currentMode: mode })
    const modes = [
      'Vacuum',
      'Mop',
      'Vacuum & Mop',
      'Deep Clean',
      'Deep Vacuum',
      'Deep Mop',
      'Quick Clean',
      'Max Clean',
      'Min Clean',
      'Quiet Vacuum',
      'Quiet Mop',
      'Night Mode',
      'Eco Vacuum',
      'Eco Mop',
      'Auto',
    ]

    // Only emit info logs when the clean mode actually changes
    if (this.lastCleanMode !== mode) {
      this.logInfo(`clean mode updated to: ${modes[mode] || `Unknown (${mode})`}`)
      this.lastCleanMode = mode
      this.persistCache('lastCleanMode', mode)
    } else {
      this.logDebug(`clean mode unchanged: ${modes[mode] || `Unknown (${mode})`}`)
    }
  }

  public updateSelectedAreas(areaIds: number[]): void {
    this.updateState('serviceArea', { selectedAreas: areaIds })

    // Determine if the selection actually changed (order-insensitive)
    const incoming = Array.isArray(areaIds) ? areaIds.slice().sort((a, b) => a - b) : []
    const previous = Array.isArray(this.lastSelectedAreas) ? this.lastSelectedAreas.slice().sort((a, b) => a - b) : null

    let changed = false
    if (previous === null) {
      changed = true
    } else if (previous.length !== incoming.length) {
      changed = true
    } else {
      for (let i = 0; i < incoming.length; i++) {
        if (incoming[i] !== previous![i]) {
          changed = true
          break
        }
      }
    }

    const areaNames = areaIds.map(id =>
      ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'][id] || `Area ${id}`,
    )

    if (changed) {
      this.logInfo(`selected areas updated to: ${areaNames.join(', ') || 'All Areas'}`)
      this.lastSelectedAreas = Array.isArray(areaIds) ? areaIds.slice() : []
      this.persistCache('lastSelectedAreas', this.lastSelectedAreas)
    } else {
      this.logDebug(`selected areas unchanged: ${areaNames.join(', ') || 'All Areas'}`)
    }
  }

  public updateCurrentArea(areaId: number | null): void {
    this.updateState('serviceArea', { currentArea: areaId })
    if (areaId !== null) {
      const areaName = ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'][areaId] || `Area ${areaId}`
      this.logInfo(`current area updated to: ${areaName}`)
    } else {
      this.logInfo('current area cleared')
    }
  }

  public updateProgress(progress: Array<{ areaId: number, status: number }>): void {
    this.updateState('serviceArea', { progress })
    this.logInfo(`progress updated: ${progress.length} areas`)
  }
}
