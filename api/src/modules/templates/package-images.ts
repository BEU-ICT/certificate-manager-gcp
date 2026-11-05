export type ImageKind = 'png' | 'jpeg';

export interface ImageHeader {
  kind: ImageKind;
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Content type by magic bytes, `undefined` when it is neither PNG nor JPEG. */
export function sniffImage(bytes: Buffer): ImageKind | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  return undefined;
}

/** Image kind a file name promises (`undefined` for other extensions). */
export function kindFromExtension(file: string): ImageKind | undefined {
  const lower = file.toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpeg';
  return undefined;
}

/** Start-of-frame markers carry the dimensions (not DHT, JPG and DAC). */
const isStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpegSize(bytes: Buffer): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return undefined;
    if (isStartOfFrame(marker)) {
      if (offset + 9 > bytes.length) return undefined;
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}

/** Reads the dimensions from the header only; `undefined` when the header is truncated or invalid. */
export function readImageHeader(bytes: Buffer): ImageHeader | undefined {
  const kind = sniffImage(bytes);
  if (kind === 'png') {
    if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
    return { kind, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (kind === 'jpeg') {
    const size = jpegSize(bytes);
    return size === undefined ? undefined : { kind, ...size };
  }
  return undefined;
}
