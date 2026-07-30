import { describe, expect, it } from 'vitest'

import { Properties } from './properties.js'
import { describeRoomList } from './sharkiq.js'

/**
 * Room-specific cleaning (#41) depends on the vacuum publishing
 * `Robot_Room_List`, which varies by model and by which API it is live on.
 *
 * These cover the log line that reports it. It exists because the plugin used
 * to log only a property *count* ("Read 77 properties"), so when a reporter was
 * asked to look for a room list there was nothing to find either way — an
 * absent list and an unlogged one looked identical.
 */
describe('describeRoomList', () => {
  it('says plainly when the vacuum does not report a room list', () => {
    const line = describeRoomList(undefined)
    expect(line).toContain('not reported by this vacuum')
    expect(line).toContain('room-specific cleaning is not available')
  })

  it('treats an empty string as not reported, not as zero rooms', () => {
    expect(describeRoomList('')).toContain('not reported by this vacuum')
  })

  it('treats null and a non-string as not reported', () => {
    expect(describeRoomList(null)).toContain('not reported by this vacuum')
    expect(describeRoomList(42)).toContain('not reported by this vacuum')
  })

  it('lists the map identifier and the room names when they are there', () => {
    const line = describeRoomList('map1:Kitchen:Hallway:Lounge')
    expect(line).toContain('map "map1"')
    expect(line).toContain('3 room(s)')
    expect(line).toContain('Kitchen, Hallway, Lounge')
  })

  it('distinguishes a map with no rooms from no map at all', () => {
    expect(describeRoomList('map1')).toContain('no rooms in it')
    expect(describeRoomList('map1')).not.toContain('not reported')
  })

  it('names the property so it can be searched for in a log', () => {
    expect(describeRoomList(undefined)).toContain(Properties.ROBOT_ROOM_LIST)
    expect(describeRoomList('map1:Kitchen')).toContain(Properties.ROBOT_ROOM_LIST)
  })
})
