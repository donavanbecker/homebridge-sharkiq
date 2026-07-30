import { describe, expect, it } from 'vitest'

import {
  BATTERY_CRITICAL_THRESHOLD,
  BATTERY_LOW_THRESHOLD,
  isKnownCleanMode,
  MATTER_CLEAN_MODES,
  matterPowerSourceState,
  readVacuumBattery,
} from './sharkiq.js'

/**
 * Battery and suction level (#88). Neither reached HomeKit on either protocol
 * before this, despite the vacuum reporting both.
 */
describe('readVacuumBattery', () => {
  it('reads a plain percentage', () => {
    expect(readVacuumBattery(87, 0).percent).toBe(87)
  })

  it('accepts the string form the api sometimes returns', () => {
    expect(readVacuumBattery('87', '0').percent).toBe(87)
  })

  it('reports an unknown battery as undefined, not as zero', () => {
    // 0% and "not reported" mean very different things to a user
    expect(readVacuumBattery(undefined, 0).percent).toBeUndefined()
    expect(readVacuumBattery('', 0).percent).toBeUndefined()
    expect(readVacuumBattery('not a number', 0).percent).toBeUndefined()
  })

  it('clamps nonsense into range', () => {
    expect(readVacuumBattery(-5, 0).percent).toBe(0)
    expect(readVacuumBattery(150, 0).percent).toBe(100)
  })

  it('detects charging in the forms the api uses', () => {
    expect(readVacuumBattery(50, 1).charging).toBe(true)
    expect(readVacuumBattery(50, '1').charging).toBe(true)
    expect(readVacuumBattery(50, true).charging).toBe(true)
    expect(readVacuumBattery(50, 0).charging).toBe(false)
    expect(readVacuumBattery(50, undefined).charging).toBe(false)
  })

  it('flags low and critical at the documented thresholds', () => {
    expect(readVacuumBattery(BATTERY_LOW_THRESHOLD, 0).low).toBe(false)
    expect(readVacuumBattery(BATTERY_LOW_THRESHOLD - 1, 0).low).toBe(true)
    expect(readVacuumBattery(BATTERY_LOW_THRESHOLD - 1, 0).chargeLevel).toBe(1)
    expect(readVacuumBattery(BATTERY_CRITICAL_THRESHOLD - 1, 0).chargeLevel).toBe(2)
    expect(readVacuumBattery(100, 0).chargeLevel).toBe(0)
  })

  it('never calls an unknown battery low', () => {
    expect(readVacuumBattery(undefined, 0).low).toBe(false)
    expect(readVacuumBattery(undefined, 0).chargeLevel).toBe(0)
  })
})

describe('matterPowerSourceState', () => {
  it('doubles the percentage, as Matter requires', () => {
    // Matter encodes batPercentRemaining in half-percent steps: 100% is 200.
    // Sending the plain percentage would show every battery at half charge.
    expect(matterPowerSourceState(readVacuumBattery(100, 0)).batPercentRemaining).toBe(200)
    expect(matterPowerSourceState(readVacuumBattery(50, 0)).batPercentRemaining).toBe(100)
    expect(matterPowerSourceState(readVacuumBattery(1, 0)).batPercentRemaining).toBe(2)
  })

  it('sends null rather than 0 when the battery is unknown', () => {
    expect(matterPowerSourceState(readVacuumBattery(undefined, 0)).batPercentRemaining).toBeNull()
  })

  it('reports the charge state', () => {
    // 1 IsCharging, 2 IsAtFullCharge, 3 IsNotCharging
    expect(matterPowerSourceState(readVacuumBattery(50, 1)).batChargeState).toBe(1)
    expect(matterPowerSourceState(readVacuumBattery(100, 0)).batChargeState).toBe(2)
    expect(matterPowerSourceState(readVacuumBattery(50, 0)).batChargeState).toBe(3)
  })

  it('passes the charge level straight through', () => {
    expect(matterPowerSourceState(readVacuumBattery(5, 0)).batChargeLevel).toBe(2)
  })

  it('declares a present, non-replaceable battery', () => {
    const state = matterPowerSourceState(readVacuumBattery(50, 0))
    expect(state.batPresent).toBe(true)
    expect(state.batReplacementNeeded).toBe(false)
    expect(state.status).toBe(1)
  })
})

describe('matter clean modes', () => {
  it('uses the vacuum\'s own power mode numbers, so the two cannot drift', () => {
    // PowerModes: ECO 1, NORMAL 0, MAX 2
    expect(MATTER_CLEAN_MODES.find(m => m.label === 'Eco')?.mode).toBe(1)
    expect(MATTER_CLEAN_MODES.find(m => m.label === 'Normal')?.mode).toBe(0)
    expect(MATTER_CLEAN_MODES.find(m => m.label === 'Max')?.mode).toBe(2)
  })

  it('gives every mode a unique number and label', () => {
    expect(new Set(MATTER_CLEAN_MODES.map(m => m.mode)).size).toBe(MATTER_CLEAN_MODES.length)
    expect(new Set(MATTER_CLEAN_MODES.map(m => m.label)).size).toBe(MATTER_CLEAN_MODES.length)
  })

  it('gives every mode a tag, which matter requires', () => {
    for (const mode of MATTER_CLEAN_MODES) {
      expect(mode.modeTags.length).toBeGreaterThan(0)
    }
  })

  it('recognises only modes the vacuum actually has', () => {
    expect(isKnownCleanMode(0)).toBe(true)
    expect(isKnownCleanMode(1)).toBe(true)
    expect(isKnownCleanMode(2)).toBe(true)
    expect(isKnownCleanMode(3)).toBe(false)
    expect(isKnownCleanMode(-1)).toBe(false)
  })
})
