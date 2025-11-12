import { expect, it, vi } from 'vitest'

import { BaseMatterAccessory } from '../devices/BaseMatterAccessory.js'

// Spy for updateAccessoryState
const mockUpdate = vi.fn(async () => {})
const mockApi: any = {
  matter: {
    uuid: { generate: (s: string) => `uuid-${s}` },
    deviceTypes: { RoboticVacuumCleaner: 123 },
    updateAccessoryState: mockUpdate,
  },
}

const mockLogger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

class TranslateAccessory extends BaseMatterAccessory {
  constructor(api: any, log: any) {
    super(api, log, {
      uuid: api.matter.uuid.generate('test-translate'),
      displayName: 'TranslateTest',
      deviceType: (api.matter.deviceTypes.RoboticVacuumCleaner as any) || 0,
      serialNumber: 'SN-T-1',
      manufacturer: 'TestCo',
      model: 'T-1',
      firmwareRevision: '1.0',
      hardwareRevision: '1.0',
      // Register rvcOperationalState so translations have a target
      clusters: {
        rvcOperationalState: { operationalStateList: [{ operationalStateId: 0 }, { operationalStateId: 1 }, { operationalStateId: 65 }], operationalState: 0 },
      },
      // Ensure translation enabled explicitly
      translateLegacyClusters: true,
    })
  }

  public async callUpdateState(cluster: string, attrs: Record<string, unknown>) {
    await (this as any).updateState(cluster, attrs)
  }
}

it('translates power.charging -> rvcOperationalState when target exists', async () => {
  mockUpdate.mockClear()

  const acc = new TranslateAccessory(mockApi, mockLogger)

  await acc.callUpdateState('power', { batteryLevel: 42, charging: true })

  // Expect updateAccessoryState called to set rvcOperationalState to 65 (Charging)
  expect(mockUpdate).toHaveBeenCalled()
  const calls = mockUpdate.mock.calls as any
  const found = calls.find((c: any) => c[1] === 'rvcOperationalState')
  expect(found).toBeDefined()
  const args = found as any
  const attrs = args[2] as any
  expect(attrs.operationalState).toBe(65)
})
