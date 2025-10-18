import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RoboticVacuumAccessory } from '../src/devices/RoboticVacuumAccessory.js'

// Minimal mock logger matching Homebridge Logger
function createLogger() {
  const info = vi.fn()
  const debug = vi.fn()
  const warn = vi.fn()
  const error = vi.fn()
  return { info, debug, warn, error }
}

// Minimal API mock with matter helpers used in constructor
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

describe('roboticVacuumAccessory.updateRunMode', () => {
  let log: any
  let api: any
  let acc: RoboticVacuumAccessory

  beforeEach(() => {
    log = createLogger()
    api = createApi()
    acc = new RoboticVacuumAccessory(api, log as any, undefined, 0)
    // clear any persisted context written during constructor
    acc.context.lastRunMode = null
  })

  it('should emit info only when run mode changes and persist to context', () => {
    // Initially lastRunMode is null
    acc.updateRunMode(1)
    expect(log.info).toHaveBeenCalled()
    expect(acc.context.lastRunMode).toBe(1)

    // Calling again with same mode should not call info again (only debug)
    log.info.mockClear()
    acc.updateRunMode(1)
    expect(log.info).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalled()

    // Change to Idle
    log.info.mockClear()
    acc.updateRunMode(0)
    expect(log.info).toHaveBeenCalled()
    expect(acc.context.lastRunMode).toBe(0)
  })
})
