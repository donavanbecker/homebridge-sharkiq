/**
 * Base Matter Accessory Class
 *
 * This base class implements the MatterAccessory interface and provides
 * common functionality that all Matter devices can use.
 *
 * Individual device types should extend this class and call super() with
 * the required configuration.
 */

import type { API, EndpointType, Logger, MatterAccessory } from 'homebridge'

export interface BaseMatterAccessoryConfig {
  uuid: string
  displayName: string
  deviceType: EndpointType
  serialNumber: string
  manufacturer: string
  model: string
  firmwareRevision: string
  hardwareRevision: string
  context?: Record<string, unknown>
  clusters?: MatterAccessory['clusters']
  handlers?: MatterAccessory['handlers']
  parts?: MatterAccessory['parts']
  /** Optional mapping from legacy cluster names to supported cluster names. */
  clusterNameMap?: Record<string, string>
  /** Enable translation behavior for legacy clusters like 'power' and 'diagnostics'. */
  translateLegacyClusters?: boolean
}

/**
 * Base class for all Matter accessories
 * Implements the MatterAccessory interface and provides common methods
 */
export abstract class BaseMatterAccessory implements MatterAccessory {
  // Required MatterAccessory properties
  public readonly uuid: string
  public readonly displayName: string
  public readonly deviceType: EndpointType
  public readonly serialNumber: string
  public readonly manufacturer: string
  public readonly model: string
  public readonly firmwareRevision: string
  public readonly hardwareRevision: string
  public readonly context: Record<string, unknown>
  public readonly clusters?: MatterAccessory['clusters']
  public readonly handlers?: MatterAccessory['handlers']
  public readonly parts?: MatterAccessory['parts']
  /** Optional mapping table for legacy cluster names */
  public readonly clusterNameMap?: Record<string, string>
  /** Whether to translate legacy clusters (can be toggled at runtime via context.translateLegacyClusters) */
  protected readonly translateLegacyClusters: boolean

  // Protected properties available to child classes
  protected readonly api: API
  protected readonly log: Logger

  constructor(
    api: API,
    log: Logger,
    config: BaseMatterAccessoryConfig,
  ) {
    this.api = api
    this.log = log

    // Set all required properties
    this.uuid = config.uuid
    this.displayName = config.displayName
    this.deviceType = config.deviceType
    this.serialNumber = config.serialNumber
    this.manufacturer = config.manufacturer
    this.model = config.model
    this.firmwareRevision = config.firmwareRevision
    this.hardwareRevision = config.hardwareRevision
    this.clusters = config.clusters
    this.handlers = config.handlers
    this.parts = config.parts
    this.clusterNameMap = config.clusterNameMap || {}
    this.translateLegacyClusters = typeof config.translateLegacyClusters === 'boolean' ? config.translateLegacyClusters : true

    // Set context with all metadata
    this.context = {
      serialNumber: this.serialNumber,
      manufacturer: this.manufacturer,
      model: this.model,
      firmwareRevision: this.firmwareRevision,
      hardwareRevision: this.hardwareRevision,
      ...config.context,
    }
  }

  /**
   * Update the accessory state
   * Helper method to update cluster attributes
   */
  protected async updateState(cluster: string, attributes: Record<string, unknown>): Promise<void> {
    // First, allow a configured mapping from legacy cluster names to the
    // clusters we actually registered. This supports older code paths that
    // attempted to update clusters like 'power' or 'diagnostics'. The mapping
    // is optional and can be provided per-accessory via config.
    const mapped = (this.clusterNameMap && this.clusterNameMap[cluster]) || cluster

    // If the mapped cluster exists on this accessory and this is not a
    // legacy cluster that requires translation, forward the update.
    const isLegacy = cluster === 'power' || cluster === 'diagnostics'
    if (this.clusters && (mapped in this.clusters) && !isLegacy) {
      await this.api.matter.updateAccessoryState(this.uuid, mapped, attributes)
      this.log.debug(`[${this.displayName}] Updated ${mapped} state (from ${cluster}):`, attributes)
      return
    }

    // Special-case handling for legacy clusters when no direct mapping exists.
    // These translate a small set of commonly-updated attributes into updates
    // against supported clusters (for vacuum devices we commonly support
    // 'rvcOperationalState'). This avoids noisy "Behavior ID ... does not
    // exist" errors while preserving useful state updates.
    // Determine whether translations are enabled for this accessory at runtime.
    const runtimeTranslate = typeof (this.context as any).translateLegacyClusters === 'boolean'
      ? (this.context as any).translateLegacyClusters
      : this.translateLegacyClusters

    if (cluster === 'power') {
      // batteryLevel and charging are informational. If charging is present
      // and we have rvcOperationalState, translate charging->Charging(65)
      // or not-charging->Docked(66). Also log battery percentage locally.
      const batteryLevel = attributes.batteryLevel as number | undefined
      const charging = attributes.charging as boolean | number | undefined

      if (typeof batteryLevel === 'number') {
        // Avoid noisy logs when nothing changed. Some accessories (like
        // RoboticVacuumAccessory) persist lastBatteryLevel/lastChargingStatus
        // in accessory.context so we can compare and only log on change.
        try {
          const persistedBattery = (this.context as any).lastBatteryLevel
          const persistedCharging = (this.context as any).lastChargingStatus
          const chargingBool = typeof charging === 'boolean' ? charging : (charging === 1)
          const batteryChanged = typeof persistedBattery === 'number' ? Number(persistedBattery) !== Number(batteryLevel) : true
          const chargingChanged = typeof persistedCharging === 'boolean' ? persistedCharging !== chargingBool : true
          if (batteryChanged || chargingChanged) {
            this.logInfo(`battery updated (via legacy 'power'): ${batteryLevel}%`)
          } else {
            this.logDebug(`legacy 'power' battery unchanged: ${batteryLevel}% (charging: ${String(chargingBool)})`)
          }
        } catch (e) {
          // Fallback to logging if any error occurs while comparing
          this.logInfo(`battery updated (via legacy 'power'): ${batteryLevel}%`)
        }
      }

      if (runtimeTranslate && typeof charging !== 'undefined') {
        // Choose the target cluster to update. Prefer an explicit mapping
        // if provided, otherwise fall back to rvcOperationalState when
        // available.
        const target = (this.clusterNameMap && this.clusterNameMap[cluster]) || 'rvcOperationalState'
        const targetExists = this.clusters && (target in this.clusters)
        const rvcExists = this.clusters && ('rvcOperationalState' in this.clusters)

        if (targetExists || rvcExists) {
          const isCharging = charging === true || charging === 1
          const opState = isCharging ? 65 : 66
          const chosen = targetExists ? target : 'rvcOperationalState'
          await this.api.matter.updateAccessoryState(this.uuid, chosen, { operationalState: opState })
          this.log.debug(`[${this.displayName}] Translated legacy 'power' charging=${String(charging)} -> ${chosen}=${opState}`)
          return
        }
      }

      const available = this.clusters ? Object.keys(this.clusters).join(', ') : '(none)'
      this.logWarn(`Attempt to update legacy cluster 'power' but no mapping or supported target found. Available clusters: ${available}`)
      return
    }

    if (cluster === 'diagnostics') {
      // diagnostics commonly carries an errorCode. If present and non-zero,
      // translate to rvcOperationalState Error (3) when supported.
      const errorCode = attributes.errorCode as number | undefined
      if (runtimeTranslate && typeof errorCode === 'number' && errorCode > 0) {
        const target = (this.clusterNameMap && this.clusterNameMap[cluster]) || 'rvcOperationalState'
        const targetExists = this.clusters && (target in this.clusters)
        const rvcExists = this.clusters && ('rvcOperationalState' in this.clusters)
        if (targetExists || rvcExists) {
          const chosen = targetExists ? target : 'rvcOperationalState'
          await this.api.matter.updateAccessoryState(this.uuid, chosen, { operationalState: 3 })
          this.logWarn(`[${this.displayName}] Translated legacy 'diagnostics' errorCode=${errorCode} -> ${chosen}=3 (Error)`)
          return
        }
      }

      const available = this.clusters ? Object.keys(this.clusters).join(', ') : '(none)'
      this.logDebug(`Attempt to update legacy cluster 'diagnostics' but no mapping or supported target found. Available clusters: ${available}`)
      return
    }

    // Fallback: warn and skip unknown clusters to avoid Matter server errors.
    const available = this.clusters ? Object.keys(this.clusters).join(', ') : '(none)'
    this.logWarn(`Attempt to update unknown cluster '${cluster}' (mapped to '${mapped}'). Available clusters: ${available}`)
  }

  /**
   * Log helper methods
   */
  protected logInfo(message: string, ...args: unknown[]): void {
    this.log.info(`[${this.displayName}] ${message}`, ...args)
  }

  protected logError(message: string, ...args: unknown[]): void {
    this.log.error(`[${this.displayName}] ${message}`, ...args)
  }

  protected logDebug(message: string, ...args: unknown[]): void {
    this.log.debug(`[${this.displayName}] ${message}`, ...args)
  }

  protected logWarn(message: string, ...args: unknown[]): void {
    this.log.warn(`[${this.displayName}] ${message}`, ...args)
  }

  /**
   * Convert this class instance to a plain MatterAccessory object
   * This is what gets registered with Homebridge
   */
  public toAccessory(): MatterAccessory {
    return {
      uuid: this.uuid,
      displayName: this.displayName,
      deviceType: this.deviceType,
      serialNumber: this.serialNumber,
      manufacturer: this.manufacturer,
      model: this.model,
      firmwareRevision: this.firmwareRevision,
      hardwareRevision: this.hardwareRevision,
      context: this.context,
      clusters: this.clusters,
      handlers: this.handlers,
      parts: this.parts,
    }
  }
}
