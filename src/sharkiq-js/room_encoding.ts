import { Buffer, transcode } from 'node:buffer'

/**
 * Encode a list of room names into the Shark/Ayla base64 payload used by SharkIQ
 * devices. This mirrors the logic from the sharkiqlibs Python implementation so
 * area-cleaning payloads are byte-identical.
 */
export function encodeRoomList(rooms: string[] | null | undefined, identifier = ''): string {
  if (!rooms) {
    return '*'
  }

  if (Array.isArray(rooms) && rooms.length === 0) {
    return '*'
  }

  // Header bytes (control characters) used by the device
  let header = '\x80\x01\x0B\xCA\x02'

  // Build rooms section: for each room, prefix with a single byte length and
  // separate entries with a newline (0x0A). This matches the Python impl.
  let rooms_enc = ''
  rooms.forEach((room) => {
    rooms_enc += `${String.fromCharCode(room.length) + room}\n`
  })
  rooms_enc = rooms_enc.replace(/\n$/, '')

  // Footer: 0x1A followed by one-byte length of identifier and the identifier
  const footer = `\x1A${String.fromCharCode(identifier.length)}${identifier}`

  // Length byte: remaining payload length (rooms + footer) plus one for newline
  const header_byte = String.fromCharCode(0 + 1 + rooms_enc.length + footer.length)
  header += header_byte
  header += '\n'

  // Convert UTF-8 string to latin1 bytes then base64 encode the result. This
  // mirrors Python's encode(..., 'latin1') behavior.
  const latin1Buffer = transcode(Buffer.from(header + rooms_enc + footer), 'utf8', 'latin1')
  return Buffer.from(latin1Buffer).toString('base64')
}

export default encodeRoomList
