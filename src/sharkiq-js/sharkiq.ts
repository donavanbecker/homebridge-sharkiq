import type { Logger } from 'homebridge'

import type { AylaApi } from './ayla_api.js'
import type { SkegoxApi } from './skegox_api.js'

import { Buffer, transcode } from 'node:buffer'

import { safeJsonParse } from '../utils.js'
import { global_vars } from './const.js'
import { OperatingModes, PowerModes, Properties } from './properties.js'

// Strip text from property name
function _clean_property_name(raw_property_name: string): string {
  const check_for = ['SET_', 'GET_']
  if (check_for.some(v => raw_property_name.slice(0, 4).toUpperCase().includes(v))) {
    return raw_property_name.slice(4)
  } else {
    return raw_property_name
  }
}

const ERROR_DELAY = 10000
const TIMEOUT_DELAY = 30000
/**
 * Describe whether a vacuum reports a room list, for the debug log.
 *
 * Room-specific cleaning (#41) depends entirely on the vacuum publishing
 * `Robot_Room_List`, and that varies by model and by which API the vacuum is
 * live on. This states it directly rather than leaving a reporter to infer it.
 *
 * ⚠️ It exists because the plugin used to log only a property *count* ("Read 77
 * properties"). Asked to look for a room list, a reporter on #41 could not have
 * found one either way — an absent list and an unlogged one looked identical,
 * and a whole round trip was spent finding that out.
 *
 * The raw value is `mapIdentifier:room1:room2:...`.
 */
export function describeRoomList(raw: unknown): string {
  const label = `Room list (${Properties.ROBOT_ROOM_LIST})`
  if (typeof raw !== 'string' || raw === '') {
    return `${label}: not reported by this vacuum, so room-specific cleaning is not available on it.`
  }
  const [identifier, ...rooms] = raw.split(':')
  if (rooms.length === 0) {
    return `${label}: map "${identifier}" reported, but no rooms in it.`
  }
  return `${label}: map "${identifier}" with ${rooms.length} room(s): ${rooms.join(', ')}`
}

/**
 * The three generations of the "which areas to clean" property, oldest first.
 *
 * A vacuum can report all three (#41). The plugin writes
 * {@link Properties.AREAS_TO_CLEAN}, which is V2, but that was chosen before V3
 * existed, and a property *list* cannot tell us which one a given firmware acts
 * on. Logging all three lets a reporter start a single-room clean from the
 * SharkClean app and show us which one the app populates.
 */
export const AREA_FILTER_PROPERTIES = ['Areas_To_Clean', 'AreasToClean_V2', 'AreasToClean_V3'] as const

/**
 * Render one area-filter value for the debug log.
 *
 * The encoded form is a length-prefixed room list carrying control bytes, so it
 * is shown as hex with a printable rendering beside it rather than dumped raw
 * into the log.
 */
export function describeAreaFilter(name: string, raw: unknown): string {
  if (raw === undefined) {
    return `${name}: not reported`
  }
  if (raw === null || raw === '') {
    return `${name}: empty`
  }
  const text = String(raw)
  const hex = Buffer.from(text, 'latin1').toString('hex')
  const printable = text.replace(/[^\x20-\x7E]/g, '.')
  return `${name}: ${text.length} byte(s) hex=${hex} printable="${printable}"`
}

/**
 * Options for a V3 room clean, with the defaults observed on a real vacuum.
 *
 * ⚠️ Every value here came from ONE device (RV2800AF-UK, #41) doing one clean.
 * They are what the SharkClean app sent, not a documented default, so they are
 * settings rather than constants.
 */
export interface RoomCleanOptions {
  /**
   * Key inside `areas_to_clean`. The observed value was `UltraClean`, which is
   * what that app calls "Matrix Clean". Other models may name it differently.
   */
  mode?: string
  /** Number of passes. Observed: 2. */
  cleanCount?: number
  /** `dry` to vacuum, and presumably `wet`/`mop` on models that mop. Observed: `dry`. */
  cleanType?: string
}

export const ROOM_CLEAN_DEFAULTS: Required<RoomCleanOptions> = {
  mode: 'UltraClean',
  cleanCount: 2,
  cleanType: 'dry',
}

/**
 * Build the V3 area filter: plain JSON, unlike V2's length-prefixed binary blob.
 *
 * Reproduced from a capture in #41 — a Kitchen clean started from the app sent:
 *
 * ```json
 * {"areas_to_clean":{"UltraClean":["Kitchen"]},"clean_count":2,"floor_id":"6ABE3ECC","cleantype":"dry"}
 * ```
 *
 * Key order matches that payload. It should not matter to a JSON parser, but
 * this is reverse-engineered from one sample and there is no upside to differing.
 *
 * `floorId` is the map identifier from `Robot_Room_List`, so no extra lookup is
 * needed — the room list already carries it.
 */
export function encodeRoomListV3(rooms: string[], floorId: string, options: RoomCleanOptions = {}): string {
  const { mode, cleanCount, cleanType } = { ...ROOM_CLEAN_DEFAULTS, ...options }
  return JSON.stringify({
    areas_to_clean: { [mode]: rooms },
    clean_count: cleanCount,
    floor_id: floorId,
    cleantype: cleanType,
  })
}

/**
 * Which area-filter property to write for this vacuum.
 *
 * A vacuum that reports V3 is on the newer scheme and ignores V2 — confirmed in
 * #41, where V2 stayed at `*` for the whole of a room clean while V3 carried the
 * request. Older vacuums never report V3, so they keep the V2 binary path.
 */
export function chooseAreaFilterProperty(propertyValues: Record<string, unknown> | undefined): 'AreasToClean_V2' | 'AreasToClean_V3' {
  return propertyValues?.AreasToClean_V3 === undefined ? 'AreasToClean_V2' : 'AreasToClean_V3'
}

/** One entry of the Matter ServiceArea cluster's `supportedAreas`. */
export interface MatterSupportedArea {
  areaId: number
  mapId: number | null
  areaInfo: {
    locationInfo: { locationName: string, floorNumber: number | null, areaType: number | null }
    landmarkInfo: null
  }
}

/**
 * Turn the vacuum's room list into Matter `supportedAreas`.
 *
 * ⚠️ Area ids are the room's 1-based position in the list, so they are only as
 * stable as the order the vacuum reports. If a user renames or reorders rooms in
 * the SharkClean app, a controller's saved selection can point at a different
 * room. Ids start at 1 because 0 is a reserved-looking value that some
 * controllers treat as "unset".
 */
export function buildSupportedAreas(rooms: string[]): MatterSupportedArea[] {
  return rooms.map((locationName, index) => ({
    areaId: index + 1,
    mapId: null,
    areaInfo: {
      locationInfo: { locationName, floorNumber: null, areaType: null },
      landmarkInfo: null,
    },
  }))
}

/**
 * Map the area ids a controller selected back to the room names the vacuum wants.
 *
 * Unknown ids are dropped rather than throwing: a stale selection left over from
 * a renamed map should clean the rooms it still recognises, not fail outright.
 * An empty result means "no recognised rooms", which callers must treat as a
 * whole-house clean rather than an empty area filter — writing an empty filter is
 * what stopped the vacuum leaving the dock in #68.
 */
export function areaIdsToRoomNames(areaIds: number[], rooms: string[]): string[] {
  return areaIds
    .map(id => rooms[id - 1])
    .filter((name): name is string => typeof name === 'string')
}

export interface DeviceDct {
  dsn: string
  key: string
  oem_model: string
  product_name: string
}

interface Log extends Logger {
  warn: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
  info: (message: string, ...args: any[]) => void
  success: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
}

class SharkIqVacuum {
  ayla_api: AylaApi
  _dsn: string
  _key: string
  _oem_model_number: string
  _vac_model_number: string
  _vac_serial_number: string
  properties_full
  property_values
  _settable_properties
  europe: boolean
  _name: string
  _firmware_version: string
  log: Logger
  _error: string | null
  skegox: SkegoxApi | null
  /** Per-vacuum overrides for the V3 room-clean payload (#41) */
  roomCleanOptions: RoomCleanOptions

  // Shark IQ vacuum entity
  constructor(ayla_api: AylaApi, device_dct: DeviceDct, log: Log, europe = false) {
    this.ayla_api = ayla_api
    this._dsn = device_dct.dsn
    this._key = device_dct.key
    this._oem_model_number = device_dct.oem_model
    this._vac_model_number = ''
    this._vac_serial_number = ''
    this.properties_full = {}
    this.property_values = {}
    this._settable_properties = null
    this.europe = europe
    this._name = device_dct.product_name
    this._firmware_version = ''
    this.log = log
    this._error = null
    this.skegox = null
    this.roomCleanOptions = {}
  }

  // Get oem model number
  get oem_model_number(): string {
    return this._oem_model_number
  }

  // Get vacuum model number
  get vac_model_number(): string {
    return this._vac_model_number
  }

  // Get vacuum serial number
  get vac_serial_number(): string {
    return this._vac_serial_number
  }

  // Get vacuum name
  get name(): string {
    return this._name
  }

  // Get device serial number
  get serial_number(): string {
    return this._dsn
  }

  // Get current operating mode
  operating_mode(): number {
    return this.get_property_value(Properties.OPERATING_MODE)
  }

  // Get current docked status
  docked_status(): number {
    return this.get_property_value(Properties.DOCKED_STATUS)
  }

  // Get current power mode
  power_mode(): number {
    return this.get_property_value(Properties.POWER_MODE)
  }

  // Update vacuum details such as the model and serial number. These come
  // from optional properties, so a vacuum that does not report them must not
  // take the whole plugin down with it (#85).
  _update_metadata(): void {
    const model_and_serial = this.get_property_value(Properties.DEVICE_SERIAL_NUMBER)
    if (typeof model_and_serial === 'string' && model_and_serial.trim() !== '') {
      const model_serial_split = model_and_serial.split(/(\s+)/).filter((e) => {
        return e.trim().length > 0
      })
      this._vac_model_number = model_serial_split[0] ?? ''
      this._vac_serial_number = model_serial_split[1] ?? ''
    } else {
      this.log.debug(`No model or serial number reported for ${this._dsn}.`)
    }
    this._firmware_version = this.get_property_value(Properties.ROBOT_FIRMWARE_VERSION) ?? ''
  }

  // Get url for the endpoint of the setting a property API
  set_property_endpoint(property_name): string {
    return `${this.europe ? global_vars.EU_DEVICE_URL : global_vars.DEVICE_URL}`
      + `/apiv1/dsns/${this._dsn}/properties/${property_name}/datapoints.json`
  }

  // Get a device property value
  get_property_value(property_name) {
    if (property_name.value) {
      property_name = property_name.value
    }
    return this.property_values[property_name]
  }

  // Set a device property value
  async set_property_value(property_name, value, attempt = 0): Promise<void> {
    if (property_name.value) {
      property_name = property_name.value
    }
    if (value.value) {
      value = value.value
    }

    // Newer vacuums only act on commands sent through the newer SharkNinja
    // API - the Ayla request below succeeds but the vacuum ignores it (#68).
    // Try the new API first when this vacuum is known to it, and fall back
    // to Ayla on any error so older setups keep working.
    if (this.skegox?.available(this._dsn)) {
      try {
        await this.skegox.setProperty(this._dsn, property_name, value)
        this.log.debug(`Set property ${property_name} to ${value} via the new SharkNinja API.`)
        this.properties_full[property_name] = value
        // Read the state back shortly after a mode command, to show in the
        // debug log whether the vacuum actually picked the command up
        if (property_name === Properties.OPERATING_MODE) {
          setTimeout(async () => {
            try {
              this.log.debug(`New-API state check for ${this._dsn}: ${await this.skegox!.describeState(this._dsn)}`)
            } catch (error) {
              this.log.debug(`New-API state check failed for ${this._dsn}: ${error}`)
            }
          }, 4000)
        }
        return
      } catch (error) {
        this.log.debug(`New SharkNinja API could not set ${property_name} (${error}), falling back to the Ayla API.`)
      }
    }

    const end_point = this.set_property_endpoint(`SET_${property_name}`)
    const data = { datapoint: { value } }
    try {
      const auth_header = await this.ayla_api.auth_header()
      const resp = await this.ayla_api.makeRequest('POST', end_point, data, auth_header)
      if (resp.ok !== true) {
        // Check if this is an authentication error (401) that requires token refresh
        if (resp.status === 401) {
          this.log.debug(`Authentication error setting property ${property_name}, attempting token refresh`)
          const status = await this.ayla_api.attempt_refresh(attempt, false)
          if (!status && attempt === 1) {
            this.log.warn(`Failed to set property ${property_name} after authentication retry`)
            return
          } else {
            await this.set_property_value(property_name, value, attempt + 1)
            return
          }
        } else {
          // For non-authentication errors, log as debug since vacuum may still function
          this.log.debug(`Unable to set property ${property_name} to ${value} (Status: ${resp.status}). This may be normal depending on device state.`)
          this.log.debug(`API Response: ${resp.response}`)
          return
        }
      }
      // Log the successful outcome too, so a start/stop command that the API
      // accepts (but the vacuum then ignores) can be told apart from one the
      // API rejects (#68).
      this.log.debug(`Set property ${property_name} to ${value} accepted by Shark (Status: ${resp.status}).`)
      this.properties_full[property_name] = value
    } catch {
      this.log.debug('Promise Rejected with setting property value.')
    }
  }

  // Get the url for the endpoint that gets property values
  get update_url(): string {
    return `${this.europe ? global_vars.EU_DEVICE_URL : global_vars.DEVICE_URL}/apiv1/dsns/${this.serial_number}/properties.json`
  }

  // Get properties
  async update(property_list, attempt = 0): Promise<number> {
    if (property_list) {
      if (!Array.isArray(property_list)) {
        property_list = [property_list]
      }
    }
    const full_update = !property_list
    const url = this.update_url
    try {
      // Newer vacuums no longer report fresh state to the Ayla API, so read
      // the live state from the newer SharkNinja API when this vacuum is on
      // it (#68). Full updates still go to Ayla afterwards for the device
      // metadata, with the live state overlaid on top at the end.
      if (!full_update && property_list.length !== 0 && await this._apply_skegox_state()) {
        return 0
      }
      if (!full_update && property_list.length !== 0) {
        const params = new URLSearchParams()
        property_list.forEach((property) => {
          params.append('names[]', `GET_${property}`)
        })
        const auth_header = await this.ayla_api.auth_header()
        const resp = await this.ayla_api.makeRequest('GET', `${url}?${params.toString()}`, null, auth_header)
        try {
          // Use safe JSON parsing utility
          const parseResult = safeJsonParse(resp.response)
          if (!parseResult.success) {
            this.log.warn(`Error parsing JSON response for properties: ${property_list.join(', ')}`)
            this.log.debug(`Parse Error: ${parseResult.error}`)
            this.log.debug(`Raw API Response: ${resp.response}`)
            this.log.debug(`Response Status: ${resp.status}`)
            this.log.debug(`Response OK: ${resp.ok}`)
            return ERROR_DELAY
          }

          const properties = parseResult.data
          if (resp.status === 429) {
            this.log.debug('API Error: Too many requests')
            this.log.debug('Waiting an extra 30 seconds before retrying...')
            return TIMEOUT_DELAY
          } else if (resp.status === 500) {
            // Handle 500 server errors gracefully
            this.log.error(`Server error (500) - API temporarily unavailable. Status: ${resp.status}, Error: ${properties.error ? JSON.stringify(properties.error) : 'Internal server error'}`)
            return ERROR_DELAY
          } else if (resp.ok !== true) {
            this.log.warn('Error getting property values', property_list.join(', '))
            this.log.debug(`Raw API Response: ${resp.response}`)
            this.log.error(`API Error - Status: ${resp.status}, Error: ${properties.error ? JSON.stringify(properties.error) : 'Unknown error'}`)
            const status = await this.ayla_api.attempt_refresh(attempt)
            if (!status && attempt === 1) {
              return ERROR_DELAY
            } else {
              return await this.update(property_list, attempt + 1)
            }
          } else {
            this._do_update(full_update, properties)
            return 0
          }
        } catch (e) {
          this.log.warn(`Error processing API response for properties: ${property_list.join(', ')}`)
          this.log.debug(`Error Message: ${e}`)
          this.log.debug(`Raw Response: ${resp.response}`)
          return ERROR_DELAY
        }
      } else {
        const auth_header = await this.ayla_api.auth_header()
        const resp = await this.ayla_api.makeRequest('GET', url, null, auth_header)
        try {
          // Use safe JSON parsing utility
          const parseResult = safeJsonParse(resp.response)
          if (!parseResult.success) {
            this.log.warn('Error parsing JSON response for full property update')
            this.log.debug(`Parse Error: ${parseResult.error}`)
            this.log.debug(`Raw API Response (full update): ${resp.response}`)
            this.log.debug(`Response Status: ${resp.status}`)
            this.log.debug(`Response OK: ${resp.ok}`)
            return ERROR_DELAY
          }

          const properties = parseResult.data
          if (resp.status === 429) {
            this.log.debug('API Error: Too many requests')
            this.log.debug('Waiting an extra 30 seconds before retrying...')
            return TIMEOUT_DELAY
          } else if (resp.status === 500) {
            // Handle 500 server errors gracefully
            this.log.error(`Server error (500) - API temporarily unavailable. Status: ${resp.status}, Error: ${properties.error ? JSON.stringify(properties.error) : 'Internal server error'}`)
            return ERROR_DELAY
          } else if (resp.ok !== true) {
            this.log.warn('Error getting property values.')
            this.log.debug(`Raw API Response (full update): ${resp.response}`)
            this.log.error(`API Error - Status: ${resp.status}, Error: ${properties.error ? JSON.stringify(properties.error) : 'Unknown error'}`)
            const status = await this.ayla_api.attempt_refresh(attempt)
            if (!status && attempt === 1) {
              return ERROR_DELAY
            } else {
              return await this.update(property_list, attempt + 1)
            }
          } else {
            this._do_update(full_update, properties)
            await this._apply_skegox_state()
            return 0
          }
        } catch (e) {
          this.log.warn('Error processing API response for properties.')
          this.log.debug(`Error Message: ${e}`)
          this.log.debug(`Raw Response: ${resp.response}`)
          return ERROR_DELAY
        }
      }
    } catch (e) {
      this.log.debug('Promise Rejected with updating properties.')
      return ERROR_DELAY
    }
  }

  // Overlay the live state from the newer SharkNinja API onto the local
  // property values, for vacuums that are live on it. Returns whether the
  // overlay happened, so callers know if the Ayla read can be skipped.
  async _apply_skegox_state(): Promise<boolean> {
    if (!this.skegox?.available(this._dsn)) {
      return false
    }
    try {
      const values = await this.skegox.getPropertyValues(this._dsn)
      this.property_values = { ...this.property_values, ...values }
      const names = Object.keys(values)
      this.log.debug(`Read ${names.length} properties via the new SharkNinja API.`)
      // The names, not just the count. Asking a reporter to look for a property
      // in a log that only ever printed a number wasted a round trip on #41 -
      // "I can't see any mention of a room list" could not have been anything
      // else, because the list of names was never printed.
      this.log.debug(`New-API properties: ${names.sort().join(', ')}`)
      this.log.debug(this.describeRoomList())
      // Values, not just names. Which of the three area-filter generations the
      // vacuum actually acts on can only be found by watching which one changes
      // when a single-room clean is started from the SharkClean app (#41).
      this.log.debug(`Area filters: ${AREA_FILTER_PROPERTIES.map(name => describeAreaFilter(name, values[name])).join(' | ')}`)
      return true
    } catch (error) {
      this.log.debug(`New SharkNinja API state read failed (${error}), falling back to the Ayla API.`)
      return false
    }
  }

  // Update or set properties locally from update function
  _do_update(full_update, properties): void {
    const property_names = properties.map((property) => {
      return property.property.name
    })
    let settable_properties = property_names.map((property_name) => {
      if (property_name.toUpperCase().substring(0, 3) === 'SET') {
        return _clean_property_name(property_name)
      }
      return null
    })
    settable_properties = settable_properties.filter((el) => {
      return el !== null
    })
    const readable_properties = {}
    for (let i = 0; i < properties.length; i++) {
      if (properties[i].property.name.toUpperCase() !== 'SET') {
        const property_name = _clean_property_name(properties[i].property.name)
        readable_properties[property_name] = properties[i]
      }
    }

    if (full_update || this._settable_properties === null) {
      this._settable_properties = settable_properties
    } else {
      const combined_settable_properties = this._settable_properties.concat(settable_properties)
      const result = combined_settable_properties.filter((item, pos) => {
        return combined_settable_properties.indexOf(item) === pos
      })
      this._settable_properties = result
    }

    if (full_update) {
      this.properties_full = {}
    }
    this.properties_full = {
      ...this.properties_full,
      ...readable_properties,
    }

    for (const [key, value] of Object.entries(readable_properties) as [string, any][]) {
      this.property_values[key] = value.property.value
    }
  }

  // Set vacuum operating mode
  async set_operating_mode(mode: number): Promise<void> {
    try {
      const modeName = Object.keys(OperatingModes).find(k => OperatingModes[k] === mode) ?? mode
      this.log.debug(`Setting operating mode to ${modeName} (${mode}).`)
      await this.set_property_value(Properties.OPERATING_MODE, mode)
    } catch {
      this.log.debug('Promise Rejected with setting opertating mode.')
    }
  }

  // Encode room list for specifying multiple rooms
  _encode_room_list(rooms): string {
    if (!rooms) {
      return '*'
    } else if (rooms.length === 0) {
      return '*'
    }

    const room_list = this._get_device_room_list()

    let header = '\x80\x01\x0B\xCA\x02'

    let rooms_enc = ''
    rooms.forEach((room) => {
      rooms_enc += `${String.fromCharCode(room.length) + room}\n`
    })
    rooms_enc = rooms_enc.replace(/\n$/, '')

    const footer = `\x1A${String.fromCharCode(room_list.identifier.length)}${room_list.identifier}`

    const header_byte = String.fromCharCode(0 + 1 + rooms_enc.length + footer.length)
    header += header_byte
    header += '\n'

    const latin1Buffer = transcode(Buffer.from(header + rooms_enc + footer), 'utf8', 'latin1')
    const encoded = Buffer.from(latin1Buffer).toString('base64')
    return encoded
  }

  /**
   * A plain-English line about whether this vacuum reports a room list, for the
   * debug log.
   *
   * Room-specific cleaning (#41) depends entirely on the vacuum publishing
   * `Robot_Room_List`, and that varies by model and by which API the vacuum is
   * live on. This says so directly rather than leaving a reporter to infer it
   * from a property dump.
   */
  describeRoomList(): string {
    return describeRoomList(this.property_values?.[Properties.ROBOT_ROOM_LIST])
  }

  // Get object of the device room list for starting a clean
  _get_device_room_list(): { identifier: string, rooms: string[] } {
    const room_list = this.get_property_value(Properties.ROBOT_ROOM_LIST)
    const split = room_list.split(':')
    return {
      identifier: split[0],
      rooms: split.slice(1),
    }
  }

  // Get device room list (will output * for all)
  get_room_list() {
    return this._get_device_room_list().rooms
  }

  // Start the vacuum cleaning
  async clean_rooms(rooms): Promise<void> {
    try {
      // Only write an area filter for a genuine room-specific clean. For a
      // whole-house clean (no rooms) we send START on its own, the same as the
      // physical button and the Shark app. Writing the placeholder '*' area
      // filter first told the vacuum to clean an empty set of areas, so it
      // accepted START but never left the dock (#68).
      if (rooms && rooms.length > 0) {
        // Which generation of the area filter this vacuum listens to decides
        // both the property AND the encoding - V3 is JSON, V2 a binary blob, so
        // the two are not interchangeable (#41).
        const property = chooseAreaFilterProperty(this.property_values)
        const payload = property === 'AreasToClean_V3'
          ? encodeRoomListV3(rooms, this._get_device_room_list().identifier, this.roomCleanOptions)
          : this._encode_room_list(rooms)
        this.log.debug(`Starting a clean of ${rooms.length} room(s) via ${property}: ${payload}`)
        await this.set_property_value(property, payload)
      } else {
        this.log.debug('Starting a whole-house clean.')
      }
      await this.set_operating_mode(OperatingModes.START)
    } catch {
      this.log.debug('Promise Rejected with starting clean.')
    }
  }

  // Stop or cancel a vacuum cleaning
  async cancel_clean(): Promise<void> {
    try {
      await this.set_operating_mode(OperatingModes.RETURN)
    } catch {
      this.log.debug('Promise Rejected with canceling clean.')
    }
  }
}

export { OperatingModes, PowerModes, Properties, SharkIqVacuum }
