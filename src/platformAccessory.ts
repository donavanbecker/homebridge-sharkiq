import type { CharacteristicValue, Logger, PlatformAccessory, Service, uuid } from 'homebridge'

import type { SharkIQPlatform } from './platform.js'
import type { SharkIqVacuum } from './sharkiq-js/sharkiq.js'

import { TIMEOUTS, VACUUM_SPEEDS } from './constants.js'
import { createPromiseRejectionHandler } from './errorHandling.js'
import { OperatingModes, PowerModes, Properties } from './sharkiq-js/sharkiq.js'

export class SharkIQAccessory {
  private service: Service
  private dockedStatusService: Service
  private vacuumPausedService: Service

  constructor(
    private readonly platform: SharkIQPlatform,
    private readonly accessory: PlatformAccessory,
    private device: SharkIqVacuum,
    UUIDGen: typeof uuid,
    private readonly log: Logger,
    private readonly invertDockedStatus: boolean,
    private readonly dockedUpdateInterval: number,
    private dockedDelay: number = 0,
  ) {
    // Get device serial number
    const serial_number = device._dsn
    const vacuumUUID = UUIDGen.generate(`${serial_number}-vacuum`)
    this.service = this.accessory.getService('Vacuum')
      || this.accessory.addService(this.platform.Service.Fanv2, 'Vacuum', vacuumUUID)

    // Vacuum Name - Default is device name
    this.service.setCharacteristic(this.platform.Characteristic.Name, device._name.toString())

    // // Vacuum Active
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setVacuumActive.bind(this))
      .onGet(this.getVacuumActive.bind(this))

    // Vacuum Power (Eco, Normal, Max)
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minStep: VACUUM_SPEEDS.ECO,
        minValue: VACUUM_SPEEDS.OFF,
        maxValue: VACUUM_SPEEDS.MAX,
      })
      .onSet(this.setFanSpeed.bind(this))
      .onGet(this.getFanSpeed.bind(this))

    // Vacuum Docked Status
    this.dockedStatusService = this.accessory.getService('Vacuum Docked')
      || this.accessory.addService(this.platform.Service.ContactSensor, 'Vacuum Docked', 'Docked')
    this.dockedStatusService.setCharacteristic(this.platform.Characteristic.Name, `${device._name.toString()} Docked`)
    this.dockedStatusService.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(this.retrieveDockedStatus.bind(this))

    // Vacuum Paused Status
    this.vacuumPausedService = this.accessory.getService('Vacuum Paused')
      || this.accessory.addService(this.platform.Service.Switch, 'Vacuum Paused', 'Paused')
    this.vacuumPausedService.setCharacteristic(this.platform.Characteristic.Name, `${device._name.toString()} Paused`)

    // Vacuum Paused getting and setting state
    this.vacuumPausedService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setPaused.bind(this))
      .onGet(this.getPaused.bind(this))

    this.updateStates()

    // Retrieve vacuum states
    this.retrieveVacuumStates().then(() => {
      this.retrieveVacuumStateInterval()
    }).catch(() => {
      createPromiseRejectionHandler(this.log, 'first interval update')()
      this.retrieveVacuumStateInterval()
    })
  }

  // Helper method to calculate vacuum docked status based on inversion setting
  private calculateDockedStatus(docked_status: number): boolean {
    if (!this.invertDockedStatus) {
      return docked_status === 1
    } else {
      return docked_status !== 1
    }
  }

  // Retrieve vacuum states interval function
  async retrieveVacuumStateInterval(): Promise<void> {
    setInterval(async () => {
      await this.retrieveVacuumStates()
        .catch(createPromiseRejectionHandler(this.log, 'interval update'))
    }, this.dockedUpdateInterval + this.dockedDelay)
  }

  // Retrieve docked status
  async retrieveDockedStatus(): Promise<boolean> {
    this.log.debug('Triggering GET Docked Status')
    await this.device.update(Properties.DOCKED_STATUS)

    const docked_status = this.device.docked_status()
    const vacuumDocked = this.calculateDockedStatus(docked_status)

    return vacuumDocked
  }

  // Retrieve operating mode
  async retrieveOperatingMode(): Promise<void> {
    this.log.debug('Triggering GET Operating Mode')
    await this.device.update(Properties.OPERATING_MODE)
      .then((delay) => {
        this.dockedDelay = delay
      })
  }

  // Retrieve power mode
  async retrievePowerMode(): Promise<void> {
    this.log.debug('Triggering GET Power Mode')
    await this.device.update(Properties.POWER_MODE)
      .then((delay) => {
        this.dockedDelay = delay
      })
  }

  // Monitor vacuum state function
  async retrieveVacuumStates(): Promise<void> {
    this.log.debug('Triggering GET Vacuum States')
    let vacuumDocked = false

    await this.device.update([Properties.DOCKED_STATUS, Properties.OPERATING_MODE, Properties.POWER_MODE])
      .then((delay) => {
        this.dockedDelay = delay
      })

    const docked_status = this.device.docked_status()
    vacuumDocked = this.calculateDockedStatus(docked_status)
    const power_mode = this.device.power_mode()
    const mode = this.device.operating_mode()
    const vacuumActive = mode === OperatingModes.START || mode === OperatingModes.STOP
    this.service.updateCharacteristic(this.platform.Characteristic.Active, vacuumActive)
    if (vacuumActive) {
      if (power_mode === PowerModes.MAX) {
        this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, VACUUM_SPEEDS.MAX)
      } else if (power_mode === PowerModes.ECO) {
        this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, VACUUM_SPEEDS.ECO)
      } else {
        this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, VACUUM_SPEEDS.NORMAL)
      }
      if (mode === OperatingModes.STOP) {
        this.vacuumPausedService.updateCharacteristic(this.platform.Characteristic.On, true)
      } else {
        this.vacuumPausedService.updateCharacteristic(this.platform.Characteristic.On, false)
      }
    } else {
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, VACUUM_SPEEDS.OFF)
    }
    this.dockedStatusService.updateCharacteristic(this.platform.Characteristic.ContactSensorState, vacuumDocked)

    this.log.debug('Vacuum Docked:', vacuumDocked, 'Vacuum Active:', vacuumActive, 'Power Mode:', power_mode)
  }

  // Update paused and active state on switch
  updateStates(): void {
    const mode = this.device.operating_mode()
    if (mode === OperatingModes.START || mode === OperatingModes.STOP) {
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
    } else {
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE)
    }

    if (mode === OperatingModes.STOP) {
      this.vacuumPausedService.updateCharacteristic(this.platform.Characteristic.On, true)
    } else {
      this.vacuumPausedService.updateCharacteristic(this.platform.Characteristic.On, false)
    }
  }

  // Get paused state
  async getPaused(): Promise<boolean> {
    this.log.debug('Triggering GET Paused')
    await this.retrieveOperatingMode()

    const mode = this.device.operating_mode()
    this.log.debug('State:', mode)
    if (mode === OperatingModes.STOP) {
      return true
    } else {
      return false
    }
  }

  // Set paused state
  async setPaused(value: CharacteristicValue): Promise<void> {
    this.log.debug('Triggering SET Paused. Paused:', value)

    const mode = this.device.operating_mode()
    if (mode === OperatingModes.START || mode === OperatingModes.STOP) {
      if (value) {
        await this.device.set_operating_mode(OperatingModes.STOP)
          .catch(createPromiseRejectionHandler(this.log, 'setting operating mode'))
      } else {
        await this.device.set_operating_mode(OperatingModes.START)
          .catch(createPromiseRejectionHandler(this.log, 'setting operating mode'))
      }
    } else {
      setTimeout(() => {
        this.vacuumPausedService.updateCharacteristic(this.platform.Characteristic.On, false)
      }, TIMEOUTS.PAUSED_UPDATE_DELAY)
    }
  }

  // Check if the vacuum is active for UI
  async getVacuumActive(): Promise<boolean> {
    this.log.debug('Triggering GET Vacuum Active')

    const mode = this.device.operating_mode()
    if (mode === OperatingModes.START || mode === OperatingModes.STOP) {
      return true
    } else {
      return false
    }
  }

  // Set the vacuum state by UI
  async setVacuumActive(value: CharacteristicValue): Promise<void> {
    this.log.debug('Triggering SET Vacuum Active')

    const mode = this.device.operating_mode()
    const running = mode === OperatingModes.START || mode === OperatingModes.STOP

    if (value) {
      // Turning on: start cleaning if it isn't already running. Previously this
      // handler only did anything when turning OFF, so switching the vacuum on
      // sent no command and HomeKit immediately reverted the control to off (#68).
      // Reuse the current fan speed, defaulting to max when none is set.
      if (!running) {
        const currentSpeed = Number(this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).value)
        const speed = currentSpeed > VACUUM_SPEEDS.OFF ? currentSpeed : VACUUM_SPEEDS.MAX
        await this.setFanSpeed(speed)
          .catch(createPromiseRejectionHandler(this.log, 'starting the vacuum'))
      }
    } else {
      // Turning off: stop cleaning.
      if (running) {
        await this.setFanSpeed(0)
          .catch(createPromiseRejectionHandler(this.log, 'setting fan speed'))
      }
    }
  }

  // Get vacuum power for UI
  async getFanSpeed(): Promise<number> {
    this.log.debug('Triggering GET Fan Speed')
    await this.retrievePowerMode()

    const mode = this.device.operating_mode()
    const vacuumActive = mode === OperatingModes.START || mode === OperatingModes.STOP
    if (vacuumActive) {
      const power_mode = this.device.power_mode()
      if (power_mode === PowerModes.MAX) {
        return VACUUM_SPEEDS.MAX
      } else if (power_mode === PowerModes.ECO) {
        return VACUUM_SPEEDS.ECO
      } else {
        return VACUUM_SPEEDS.NORMAL
      }
    } else {
      return VACUUM_SPEEDS.OFF
    }
  }

  // Set vacuum power from UI (and start/stop vacuum if needed)
  async setFanSpeed(value: CharacteristicValue): Promise<void> {
    this.log.debug('Triggering SET Fan Speed. Value:', value)

    let power_mode = PowerModes.NORMAL
    if (value === VACUUM_SPEEDS.ECO) {
      power_mode = PowerModes.ECO
    } else if (value === VACUUM_SPEEDS.MAX) {
      power_mode = PowerModes.MAX
    } else if (value === VACUUM_SPEEDS.OFF) {
      await this.device.cancel_clean()
        .catch(createPromiseRejectionHandler(this.log, 'cancel cleaning update'))
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE)
      this.vacuumPausedService.updateCharacteristic(this.platform.Characteristic.On, false)
      return
    }
    const isPaused = await this.getPaused()
    if (isPaused) {
      await this.device.set_operating_mode(OperatingModes.START)
        .catch(() => {
          this.log.debug('Promise Rejected with setting operating mode.')
        })
      this.vacuumPausedService.updateCharacteristic(this.platform.Characteristic.On, false)
    }
    await this.device.set_property_value(Properties.POWER_MODE, power_mode)
      .catch(createPromiseRejectionHandler(this.log, 'powermode update'))
    const mode = this.device.operating_mode()
    if (mode !== OperatingModes.START && mode !== OperatingModes.STOP) {
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      await this.device.clean_rooms([])
        .catch(createPromiseRejectionHandler(this.log, 'start cleaning update'))
    }
  }
}
