import type { API, Logger } from 'homebridge'

import type { BaseMatterAccessoryConfig } from '../devices/BaseMatterAccessory.js'

import { beforeEach, describe, expect, it } from 'vitest'

import { BaseMatterAccessory } from '../devices/BaseMatterAccessory.js'

describe('baseMatterAccessory legacy power log suppression', () => {
  let logs: string[]
  let accessory: BaseMatterAccessory
  const fakeLogger: Logger = {
    info: (msg: string) => logs.push(`info:${msg}`),
    error: (msg: string) => logs.push(`error:${msg}`),
    debug: (msg: string) => logs.push(`debug:${msg}`),
    warn: (msg: string) => logs.push(`warn:${msg}`),
  } as any
  const fakeAPI = { matter: { uuid: { generate: (s: string) => s }, deviceTypes: { RoboticVacuumCleaner: 1 } } } as unknown as API
  const config: BaseMatterAccessoryConfig = {
    uuid: 'test-uuid',
    displayName: 'TestVac',
    deviceType: fakeAPI.matter.deviceTypes.RoboticVacuumCleaner,
    serialNumber: 'SN',
    manufacturer: 'Test',
    model: 'Model',
    firmwareRevision: '1.0',
    hardwareRevision: '1.0',
  }

  beforeEach(() => {
    logs = []
    // Use a concrete subclass for testing
    class TestAccessory extends BaseMatterAccessory {
      public async testUpdate(attrs: any) {
        await this.updateState('power', attrs)
      }
    }
    accessory = new (TestAccessory as any)(fakeAPI, fakeLogger, config)
  })

  it('logs on first battery update', async () => {
    await (accessory as any).testUpdate({ batteryLevel: 100, charging: true })
    expect(logs.some(l => l.includes('battery updated (via legacy'))).toBe(true)
  })

  it('suppresses log on repeated identical update', async () => {
    await (accessory as any).testUpdate({ batteryLevel: 100, charging: true })
    logs = []
    await (accessory as any).testUpdate({ batteryLevel: 100, charging: true })
    expect(logs.some(l => l.includes('unchanged'))).toBe(true)
    expect(logs.some(l => l.includes('battery updated (via legacy'))).toBe(false)
  })

  it('logs again if battery changes', async () => {
    await (accessory as any).testUpdate({ batteryLevel: 100, charging: true })
    logs = []
    await (accessory as any).testUpdate({ batteryLevel: 99, charging: true })
    expect(logs.some(l => l.includes('battery updated (via legacy'))).toBe(true)
  })

  it('logs again if charging changes', async () => {
    await (accessory as any).testUpdate({ batteryLevel: 100, charging: true })
    logs = []
    await (accessory as any).testUpdate({ batteryLevel: 100, charging: false })
    expect(logs.some(l => l.includes('battery updated (via legacy'))).toBe(true)
  })
})
