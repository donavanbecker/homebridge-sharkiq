import { describe, expect, it } from 'vitest'

import { describeTokenExchangeFailure } from './login.js'

/**
 * The bare `Unable to get token data. HTTP 403` sent people hunting for an
 * account problem in #84 and #85, when the real cause is a login code that has
 * already been used or has expired.
 */
describe('describeTokenExchangeFailure', () => {
  it('explains what a 403 actually means and what to do next', () => {
    const message = describeTokenExchangeFailure(403)
    expect(message).toContain('HTTP 403')
    expect(message).toContain('already been used or has expired')
    expect(message).toContain('Generate a fresh login URL')
    expect(message).toContain('SharkClean app')
  })

  it('treats a 401 the same way, since it has the same cause', () => {
    expect(describeTokenExchangeFailure(401)).toContain('already been used or has expired')
  })

  it('leaves other statuses as a plain report', () => {
    // A 500 is SharkNinja's problem, not the user's - do not send them off
    // regenerating login URLs that were never the issue.
    expect(describeTokenExchangeFailure(500)).toBe('Unable to get token data. HTTP 500')
    expect(describeTokenExchangeFailure(404)).toBe('Unable to get token data. HTTP 404')
  })
})
