import { expect, it } from 'vitest'

import { RoboticVacuumAccessory } from '../devices/RoboticVacuumAccessory.js'

const mockApi: any = {
  matter: {
    uuid: { generate: (s: string) => `uuid-${s}` },
    deviceTypes: { RoboticVacuumCleaner: 123 },
    updateAccessoryState: async () => {},
  },
}

const mockLogger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

it('persists metadata into accessory context', () => {
  const mockShark: any = {
    serial_number: 'DSN-123',
    name: 'Test Shark',
    vac_model_number: 'VAC-1',
    vac_serial_number: 'V-123',
    oem_model_number: 'OEM-1',
  }

  const acc = new RoboticVacuumAccessory(mockApi as any, mockLogger as any, mockShark as any, 0)
  const serialized = acc.toAccessory()

  expect(serialized.context).toBeDefined()
  expect((serialized.context as any).serialNumber).toBe('DSN-123')
  expect((serialized.context as any).name).toBe('Test Shark')
  expect((serialized.context as any).vacModel).toBe('VAC-1')
  expect((serialized.context as any).vacSerial).toBe('V-123')
  expect((serialized.context as any).oemModel).toBe('OEM-1')
})
