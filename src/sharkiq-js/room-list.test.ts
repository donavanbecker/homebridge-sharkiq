import { describe, expect, it } from 'vitest'

import { Properties } from './properties.js'
import { AREA_FILTER_PROPERTIES, describeAreaFilter, describeRoomList } from './sharkiq.js'

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

/**
 * The area filter (#41). A vacuum can report three generations of the same
 * property; the plugin writes V2, and only a live test can show which one the
 * firmware honours. These cover the log rendering used to find that out.
 */
describe('describeAreaFilter', () => {
  it('lists the three generations oldest first', () => {
    expect([...AREA_FILTER_PROPERTIES]).toEqual(['Areas_To_Clean', 'AreasToClean_V2', 'AreasToClean_V3'])
  })

  it('includes the property the plugin actually writes', () => {
    expect(AREA_FILTER_PROPERTIES).toContain(Properties.AREAS_TO_CLEAN)
  })

  it('distinguishes not reported from empty', () => {
    expect(describeAreaFilter('AreasToClean_V2', undefined)).toBe('AreasToClean_V2: not reported')
    expect(describeAreaFilter('AreasToClean_V2', '')).toBe('AreasToClean_V2: empty')
    expect(describeAreaFilter('AreasToClean_V2', null)).toBe('AreasToClean_V2: empty')
  })

  it('renders control bytes as hex rather than dumping them into the log', () => {
    // the encoded room list is length-prefixed and carries control characters
    const encoded = '\x0A\x07Kitchen\x1A\x086ABE3ECC'
    const line = describeAreaFilter('AreasToClean_V3', encoded)
    expect(line).toContain('hex=0a074b69746368656e1a083641424533454343')
    // the printable rendering keeps the room name readable without breaking the log
    expect(line).toContain('printable="..Kitchen..6ABE3ECC"')
    expect(line).toContain(`${encoded.length} byte(s)`)
  })

  it('keeps a plain value readable', () => {
    expect(describeAreaFilter('Areas_To_Clean', '*')).toContain('printable="*"')
  })
})
