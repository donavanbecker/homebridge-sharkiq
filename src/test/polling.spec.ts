import { describe, expect, it } from 'vitest'

import { RoboticVacuumAccessory } from '../devices/RoboticVacuumAccessory.js'

// Minimal mocks for Homebridge API and logger
let mockRecorder: Array<any> = []

const mockApi: any = {
  matter: {
    uuid: { generate: (s: string) => `uuid-${s}` },
    deviceTypes: { RoboticVacuumCleaner: 123 },
    updateAccessoryState: async (uuid: string, cluster: string, attrs: Record<string, unknown>) => {
      // forward to recorder
      mockRecorder.push({ uuid, cluster, attrs })
    },
  },
}

const mockLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

describe('roboticVacuumAccessory polling & mapping', () => {
  it('maps battery, charging, rssi and error into matter clusters via polling', async () => {
    mockRecorder = []

    // Mock Shark device: update() resolves and get_property_value returns values
    const mockShark: any = {
      update: async () => Promise.resolve(0),
      get_property_value: (name: string) => {
        switch (name) {
          case 'Battery_Capacity':
            return 73
          case 'Charging_Status':
            return 1
          case 'RSSI':
            return -56
          case 'Error_Code':
            return 8
          case 'CleanComplete':
            return 0
          default:
            return null
        }
      },
    }

    const accessory = new RoboticVacuumAccessory(mockApi as any, mockLogger as any, mockShark as any, 20)

    // Wait 150ms to allow a few polling intervals to run (interval=20ms)
    await new Promise(resolve => setTimeout(resolve, 150))

    // Stop polling to clean up
    ;(accessory as any).stopPolling()

    // Since legacy 'power'/'diagnostics' clusters are not registered,
    // BaseMatterAccessory should translate important attributes to
    // supported clusters (for example, charging -> rvcOperationalState)
    // and avoid forwarding updates to non-existent behavior IDs.
    const powerUpdates = mockRecorder.filter(r => r.cluster === 'power')
    const diagUpdates = mockRecorder.filter(r => r.cluster === 'diagnostics')
    const opStateUpdates = mockRecorder.filter(r => r.cluster === 'rvcOperationalState')

    // No direct 'power' updates should be forwarded
    expect(powerUpdates.length).toBe(0)

    // We should see operational state updates derived from charging/error
    expect(opStateUpdates.length).toBeGreaterThan(0)
    const lastOp = opStateUpdates[opStateUpdates.length - 1].attrs as any
    expect(typeof lastOp.operationalState).toBe('number')

    // diagnostics shouldn't be forwarded directly either
    expect(diagUpdates.length).toBe(0)
  }, 10000)
})
