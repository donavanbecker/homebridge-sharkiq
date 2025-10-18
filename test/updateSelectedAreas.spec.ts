import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RoboticVacuumAccessory } from '../src/devices/RoboticVacuumAccessory.js'

function createLogger() {
  const info = vi.fn()
  const debug = vi.fn()
  const warn = vi.fn()
  const error = vi.fn()
  return { info, debug, warn, error }
}

function createApi() {
  return {
    matter: {
      uuid: { generate: () => 'UUID-1' },
      deviceTypes: { RoboticVacuumCleaner: 1 },
      updateAccessoryState: async () => {},
      getAccessoryState: (uuid: string, cluster: string) => {
        void uuid
        void cluster
        return null
      },
    },
  } as any
}

describe('roboticVacuumAccessory.updateSelectedAreas', () => {
  let log: any
  let api: any
  let acc: RoboticVacuumAccessory

  beforeEach(() => {
    log = createLogger()
    api = createApi()
    acc = new RoboticVacuumAccessory(api, log as any, undefined, 0)
    acc.context.lastSelectedAreas = null
  })

  it('should persist selection and only info-log on real changes (order-insensitive)', () => {
    // initial set
    acc.updateSelectedAreas([1, 2])
    expect(log.info).toHaveBeenCalled()
    expect(acc.context.lastSelectedAreas).toEqual([1, 2])

    // same selection different order => no info
    log.info.mockClear()
    log.debug.mockClear()
    acc.updateSelectedAreas([2, 1])
    expect(log.info).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalled()

    // change selection
    log.info.mockClear()
    acc.updateSelectedAreas([0, 2])
    expect(log.info).toHaveBeenCalled()
    expect(acc.context.lastSelectedAreas).toEqual([0, 2])
  })
})
