import { expect, it, vi } from 'vitest'

import { BaseMatterAccessory } from '../src/devices/BaseMatterAccessory.js'

// Minimal mock API exposing matter.updateAccessoryState spy
const mockUpdate = vi.fn(async () => {})
const mockApi: any = {
  matter: {
    uuid: { generate: (s: string) => `uuid-${s}` },
    deviceTypes: { RoboticVacuumCleaner: 123 },
    updateAccessoryState: mockUpdate,
  },
}

const mockLogger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

class TestAccessory extends BaseMatterAccessory {
  constructor(api: any, log: any) {
    super(api, log, {
      uuid: api.matter.uuid.generate('test'),
      displayName: 'Test',
      deviceType: (api.matter.deviceTypes.RoboticVacuumCleaner as any) || 0,
      serialNumber: 'SN-TEST',
      manufacturer: 'TestCo',
      model: 'T-1',
      firmwareRevision: '1.0',
      hardwareRevision: '1.0',
      // No clusters registered intentionally
      clusters: {},
    })
  }

  // Expose protected updateState for testing
  public async callUpdateState(cluster: string, attrs: Record<string, unknown>) {
    await (this as any).updateState(cluster, attrs)
  }
}

it('doesn\'t call api.matter.updateAccessoryState for legacy \'power\' when no supported cluster exists', async () => {
  const acc = new TestAccessory(mockApi, mockLogger)

  // Ensure mock hasn't been called yet
  expect(mockUpdate).toHaveBeenCalledTimes(0)

  await acc.callUpdateState('power', { batteryLevel: 50, charging: true })

  // Because there are no clusters registered, BaseMatterAccessory.updateState
  // should not forward to api.matter.updateAccessoryState. It may log a warning
  // or translate to rvcOperationalState if available, but in this test no
  // target exists so updateAccessoryState should not be called.
  expect(mockUpdate).toHaveBeenCalledTimes(0)
})
