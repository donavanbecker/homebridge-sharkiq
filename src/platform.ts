import type { API, Characteristic, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge'

import type { SharkIqVacuum } from './sharkiq-js/sharkiq'

import { join } from 'node:path'

import { TIMEOUTS } from './constants.js'
import { Login } from './login.js'
import { SharkIQAccessory } from './platformAccessory.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import { get_ayla_api } from './sharkiq-js/ayla_api.js'
import { global_vars } from './sharkiq-js/const.js'
import { SkegoxApi } from './sharkiq-js/skegox_api.js'

// SharkIQPlatform Main Class
export class SharkIQPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service
  public readonly Characteristic: typeof Characteristic

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = []
  // Device vacuums object array
  public vacuumDevices: SharkIqVacuum[] = []

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service
    this.Characteristic = this.api.hap.Characteristic
    this.log.debug('Finished initializing platform:', this.config.name)

    // Start plugin and attempt to login
    this.api.on('didFinishLaunching', () => {
      const configuredDsns = Array.isArray(config.vacuums)
        ? (config.vacuums as unknown[]).filter((dsn): dsn is string => typeof dsn === 'string' && dsn.trim() !== '')
        : []
      // With no DSNs configured, add every vacuum on the account. This is the
      // documented single-vacuum workaround for the DSN-matching problem, and it
      // needs no config at all (#64, #68).
      const addAll = configuredDsns.length === 0

      this.login().then((devices) => {
        const discovered = devices.map(device => String(device._dsn))
        log.info(`Found ${devices.length} vacuum(s) on your account: ${discovered.join(', ') || 'none'}`)

        if (addAll) {
          log.info('No vacuum DSNs configured, adding all vacuums found on your account.')
          this.vacuumDevices.push(...devices)
        } else {
          // Normalise the configured DSNs so a copy/paste from the Shark app with a
          // different case or a stray space still matches what the account returns.
          // DSNs are unique regardless of case, so this is safe (#64, #70).
          const wanted = new Set(configuredDsns.map(dsn => dsn.trim().toUpperCase()))
          for (let i = 0; i < devices.length; i++) {
            if (wanted.has(String(devices[i]._dsn).trim().toUpperCase())) {
              this.vacuumDevices.push(devices[i])
            }
          }
          if (this.vacuumDevices.length === 0) {
            log.warn(`None of the DSNs provided matched the vacuum(s) on your account. Configured: [${configuredDsns.join(', ')}], discovered: [${discovered.join(', ')}]. Leave the DSN list empty to add every vacuum on your account.`)
          }
        }
        this.discoverDevices()
      }).catch((error) => {
        log.error('Error with login.')
        log.error(error)
      })
    })
  }

  // Attempt to login and fetch devices.
  login = async (): Promise<SharkIqVacuum[]> => {
    const europe = this.config.europe || false
    const storagePath = this.api.user.storagePath()
    const auth_file = join(storagePath, global_vars.FILE)
    const oauth_file = join(storagePath, global_vars.OAUTH.FILE)
    const oAuthCode = this.config.oAuthCode || ''
    const email = this.config.email || ''
    const password = this.config.password || ''
    // Log which login method is being used based on user configuration
    // Email/password takes precedence if both are provided (matches Login class logic)
    if (email && typeof email === 'string' && email.trim() !== ''
      && password && typeof password === 'string' && password.trim() !== '') {
      this.log.info('Valid email and password present, using email and password login method.')
    } else if (oAuthCode && typeof oAuthCode === 'string' && oAuthCode.trim() !== '') {
      this.log.info('Valid OAuth code present, using OAuth login method.')
    }

    if (email !== '' && password === '') {
      return Promise.reject(new Error('Password must be present in the config if email is provided.'))
    } else if (email === '' && password !== '') {
      return Promise.reject(new Error('Email must be present in the config if password is provided.'))
    }
    const login = new Login(this.log, auth_file, oauth_file, email, password, oAuthCode, europe)
    try {
      await login.checkLogin()
      const ayla_api = get_ayla_api(auth_file, this.log, europe)
      await ayla_api.sign_in()
      const devices = await ayla_api.get_devices()
      await this.enableSkegox(devices, storagePath, europe)
      return devices
    } catch (error) {
      return Promise.reject(error)
    }
  }

  // Connect to the newer SharkNinja device API and link each vacuum to it.
  // Newer vacuums only act on commands sent through this API, so commands are
  // routed there first when the vacuum is known to it (#68). Needs the Auth0
  // token set that the OAuth Assistant stores at sign-in - without it the
  // plugin keeps working through the Ayla API alone.
  enableSkegox = async (devices: SharkIqVacuum[], storagePath: string, europe: boolean): Promise<void> => {
    const auth0_file = join(storagePath, global_vars.AUTH0_FILE)
    try {
      const skegox = new SkegoxApi(this.log, auth0_file, europe)
      const mapped = await skegox.init()
      if (mapped > 0) {
        devices.forEach((device) => {
          device.skegox = skegox
        })
        this.log.info(`Connected to the new SharkNinja API (${mapped} vacuum(s) linked) - commands will be sent there first.`)
      } else {
        this.log.info('No vacuums found on the new SharkNinja API - commands will use the Ayla API.')
      }
    } catch (error) {
      this.log.info(`Could not connect to the new SharkNinja API - commands will use the Ayla API. If a vacuum ignores start/stop commands, sign in again through the OAuth Assistant in the plugin settings to enable the new API. (${error})`)
    }
  }

  // Restore accessory cache.
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName)

    this.accessories.push(accessory)
  }

  // Add vacuums to Homebridge.
  discoverDevices(): void {
    const externalAccessory = this.config.externalAccessory || false
    const newAccessories: PlatformAccessory[] = []
    const activeAccessories: PlatformAccessory[] = []
    const cachedActiveAccessories: PlatformAccessory[] = []
    const unusedDeviceAccessories = this.accessories

    const invertDockedStatus = this.config.invertDockedStatus || false
    const dockedUpdateInterval = this.config.dockedUpdateInterval || TIMEOUTS.DEFAULT_DOCKED_UPDATE_INTERVAL
    this.vacuumDevices.forEach((vacuumDevice) => {
      const uuid = this.api.hap.uuid.generate(vacuumDevice._dsn.toString())
      let accessory = unusedDeviceAccessories.find(accessory => accessory.UUID === uuid)

      if (accessory) {
        unusedDeviceAccessories.splice(unusedDeviceAccessories.indexOf(accessory), 1)
        cachedActiveAccessories.push(accessory)
      } else {
        accessory = new this.api.platformAccessory(vacuumDevice._name.toString(), uuid)
        newAccessories.push(accessory)
      }

      let accessoryInformationService = accessory.getService(this.Service.AccessoryInformation)
      if (!accessoryInformationService) {
        accessoryInformationService = accessory.addService(this.Service.AccessoryInformation)
      }
      accessoryInformationService
        .setCharacteristic(this.Characteristic.Manufacturer, 'Shark')
        .setCharacteristic(this.Characteristic.Model, vacuumDevice._vac_model_number || 'Unknown')
        .setCharacteristic(this.Characteristic.SerialNumber, vacuumDevice._dsn)

      activeAccessories.push(accessory)
      void new SharkIQAccessory(this, accessory, vacuumDevice, this.api.hap.uuid, this.log, invertDockedStatus, dockedUpdateInterval)
    })

    if (externalAccessory) {
      if (cachedActiveAccessories.length > 0) {
        this.log.info(`Unregistering ${cachedActiveAccessories.length} bridged accessory(ies) before external publishing.`)
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, cachedActiveAccessories)
        cachedActiveAccessories.forEach((cachedAccessory) => {
          const index = this.accessories.indexOf(cachedAccessory)
          if (index >= 0) {
            this.accessories.splice(index, 1)
          }
        })
      }

      // Publish all active accessories (new and cached) as external standalone devices.
      // Each will have its own pairing code and appear independently in HomeKit.
      this.log.info(`Publishing ${activeAccessories.length} vacuum(s) as external accessory(ies).`)
      this.api.publishExternalAccessories(PLUGIN_NAME, activeAccessories)
    } else {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newAccessories)
    }

    unusedDeviceAccessories.forEach((unusedDeviceAccessory) => {
      this.log.info(`Removing unused accessory with name ${unusedDeviceAccessory.displayName}`)
      this.accessories.splice(this.accessories.indexOf(unusedDeviceAccessory), 1)
    })

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, unusedDeviceAccessories)
  }
}
