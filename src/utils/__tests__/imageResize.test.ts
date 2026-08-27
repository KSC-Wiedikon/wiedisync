import { afterEach, describe, expect, it, vi } from 'vitest'
import { downscaleImage } from '../imageResize'

// The contract this file locks down is the *safety* one: `downscaleImage` is a
// pre-pass in front of the picker's own size/type validation, so it must never
// throw and never hand back something worse than what it was given. A browser
// canvas is stubbed because the suite runs in the node environment.

interface Stub {
  /** Bytes each toBlob() call reports, in order. */
  encoded: number[]
  width: number
  height: number
  /** Canvas dimensions the code actually asked for. */
  drawnAt?: { w: number; h: number }
  qualities: number[]
}

function installCanvas(stub: Stub) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillRect: () => {}, drawImage: () => {}, fillStyle: '' }),
    toBlob: (cb: (b: Blob | null) => void, _type: string, quality: number) => {
      stub.qualities.push(quality)
      stub.drawnAt = { w: canvas.width, h: canvas.height }
      const size = stub.encoded[Math.min(stub.qualities.length - 1, stub.encoded.length - 1)]
      cb(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }))
    },
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('createImageBitmap', async () => ({
    width: stub.width,
    height: stub.height,
    close: () => {},
  }))
}

function file(bytes: number, type = 'image/jpeg', name = 'IMG_0766.jpg'): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

afterEach(() => vi.unstubAllGlobals())

describe('downscaleImage', () => {
  it('shrinks the 5.8 MB camera export that the 5 MB picker cap used to reject', async () => {
    const stub: Stub = { encoded: [300_000], width: 4032, height: 3024, qualities: [] }
    installCanvas(stub)

    const out = await downscaleImage(file(5_800_000))

    expect(out.size).toBe(300_000)
    expect(out.size).toBeLessThan(5 * 1024 * 1024)
    expect(out.type).toBe('image/jpeg')
    // Longest edge capped, aspect ratio kept.
    expect(stub.drawnAt).toEqual({ w: 1600, h: 1200 })
  })

  it('steps quality down until the encode fits', async () => {
    // First two attempts still exceed the 2 MB target, the third clears it.
    const stub: Stub = { encoded: [3_000_000, 2_500_000, 1_200_000], width: 4032, height: 3024, qualities: [] }
    installCanvas(stub)

    const out = await downscaleImage(file(9_000_000))

    expect(out.size).toBe(1_200_000)
    expect(stub.qualities).toEqual([0.85, 0.7, 0.55])
  })

  it('renames the re-encoded file to .jpg', async () => {
    installCanvas({ encoded: [200_000], width: 3000, height: 3000, qualities: [] })
    const out = await downscaleImage(file(6_000_000, 'image/png', 'portrait.PNG'))
    expect(out.name).toBe('portrait.jpg')
  })

  it('leaves an already-small image byte-identical rather than re-encoding it', async () => {
    installCanvas({ encoded: [10], width: 800, height: 600, qualities: [] })
    const input = file(120_000)
    expect(await downscaleImage(input)).toBe(input)
  })

  it('still downscales a small-in-bytes but huge-in-pixels image', async () => {
    const stub: Stub = { encoded: [80_000], width: 6000, height: 4000, qualities: [] }
    installCanvas(stub)
    const out = await downscaleImage(file(900_000))
    expect(out.size).toBe(80_000)
    expect(stub.drawnAt).toEqual({ w: 1600, h: 1067 })
  })

  it('returns the original when the re-encode came out bigger', async () => {
    installCanvas({ encoded: [9_000_000], width: 4000, height: 3000, qualities: [] })
    const input = file(2_100_000)
    expect(await downscaleImage(input)).toBe(input)
  })

  it('never re-encodes a GIF — that would drop the animation', async () => {
    installCanvas({ encoded: [1000], width: 4000, height: 3000, qualities: [] })
    const input = file(6_000_000, 'image/gif', 'wave.gif')
    expect(await downscaleImage(input)).toBe(input)
  })

  it('returns the original when the image cannot be decoded, instead of throwing', async () => {
    vi.stubGlobal('createImageBitmap', async () => { throw new Error('decode failed') })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    class FailingImage {
      naturalWidth = 0
      naturalHeight = 0
      src = ''
      decode() { return Promise.reject(new Error('no decoder')) }
    }
    vi.stubGlobal('Image', FailingImage)

    const input = file(5_800_000, 'image/heic', 'IMG_0766.HEIC')
    await expect(downscaleImage(input)).resolves.toBe(input)
  })

  it('falls back to <img> decoding when createImageBitmap rejects', async () => {
    const stub: Stub = { encoded: [400_000], width: 0, height: 0, qualities: [] }
    installCanvas(stub)
    vi.stubGlobal('createImageBitmap', async () => { throw new Error('unsupported blob') })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    class OkImage {
      naturalWidth = 3200
      naturalHeight = 1600
      src = ''
      decode() { return Promise.resolve() }
    }
    vi.stubGlobal('Image', OkImage)

    const out = await downscaleImage(file(5_800_000))

    expect(out.size).toBe(400_000)
    expect(stub.drawnAt).toEqual({ w: 1600, h: 800 })
  })
})
