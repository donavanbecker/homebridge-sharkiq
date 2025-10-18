import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { encodeRoomList } from '../src/sharkiq-js/room_encoding.js'

describe('encodeRoomList', () => {
  it('returns "*" for null or empty', () => {
    expect(encodeRoomList(null)).toBe('*')
    expect(encodeRoomList([])).toBe('*')
  })

  it('encodes rooms and includes identifier in decoded payload', () => {
    const rooms = ['kitchen', 'hall']
    const identifier = 'map1'
    const encoded = encodeRoomList(rooms, identifier)
    expect(typeof encoded).toBe('string')

    // Decode base64 then interpret bytes as latin1 to inspect payload contents
    const decodedLatin1 = Buffer.from(encoded, 'base64').toString('latin1')
    expect(decodedLatin1.includes('kitchen')).toBe(true)
    expect(decodedLatin1.includes('hall')).toBe(true)
    expect(decodedLatin1.includes(identifier)).toBe(true)
  })
})
