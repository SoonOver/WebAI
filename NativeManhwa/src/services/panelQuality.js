export const PANEL_DIMENSION_RANGE = 'bytes=0-65535';
export const PANEL_GOOD_WIDTH = 900;
export const PANEL_SOFT_WIDTH = 720;

function ascii(bytes, start, end) {
  let text = '';
  for (let i = start; i < end && i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i]);
  }
  return text;
}

function readUInt16BE(bytes, offset) {
  return (bytes[offset] << 8) + bytes[offset + 1];
}

function readUInt16LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8);
}

function readUInt32BE(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function parseJpegSize(bytes) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) return null;
    const length = readUInt16BE(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      return {
        width: readUInt16BE(bytes, offset + 5),
        height: readUInt16BE(bytes, offset + 3),
      };
    }
    offset += length;
  }
  return null;
}

function parsePngSize(bytes) {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    ascii(bytes, 1, 4) !== 'PNG'
  ) {
    return null;
  }
  return {
    width: readUInt32BE(bytes, 16),
    height: readUInt32BE(bytes, 20),
  };
}

function parseWebpSize(bytes) {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = ascii(bytes, 12, 16);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: readUInt24LE(bytes, 24) + 1,
      height: readUInt24LE(bytes, 27) + 1,
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return {
      width: readUInt16LE(bytes, 26) & 0x3fff,
      height: readUInt16LE(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

export function toByteArray(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array();
}

export function parseImagePixelSize(value) {
  const bytes = toByteArray(value);
  const size = parseJpegSize(bytes) || parsePngSize(bytes) || parseWebpSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size;
}

export function scorePanelQuality(size) {
  const width = Number(size?.width) || 0;
  const height = Number(size?.height) || 0;
  if (!width || !height) {
    return {
      status: 'unknown',
      label: 'Unknown',
      message: 'Panel source size unknown',
      width: 0,
      height: 0,
    };
  }
  if (width < PANEL_SOFT_WIDTH) {
    return {
      status: 'poor',
      label: 'Low',
      message: `${width}px source width; likely blurry on 1080p phones`,
      width,
      height,
    };
  }
  if (width < PANEL_GOOD_WIDTH) {
    return {
      status: 'soft',
      label: 'Soft',
      message: `${width}px source width; readable but not FHD sharp`,
      width,
      height,
    };
  }
  return {
    status: 'ok',
    label: 'Good',
    message: `${width}px source width`,
    width,
    height,
  };
}

export function panelProbeReferer(url, referer) {
  if (/merrypsycho\.xyz/i.test(String(url || ''))) return 'https://bbato.com/';
  return referer && String(referer).startsWith('http') ? referer : '';
}

export async function probePanelQuality(url, referer, baseHeaders = {}) {
  if (!url) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      bytes: 0,
      isImage: false,
      dimensions: null,
      quality: scorePanelQuality(null),
      error: 'Missing panel URL',
    };
  }
  const headers = {
    ...baseHeaders,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    Range: PANEL_DIMENSION_RANGE,
  };
  const probeReferer = panelProbeReferer(url, referer);
  if (probeReferer) headers.Referer = probeReferer;
  const response = await fetch(url, { headers });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const dimensions = parseImagePixelSize(bytes);
  return {
    ok: response.ok || response.status === 206,
    status: response.status,
    contentType,
    bytes: bytes.byteLength,
    isImage: contentType.startsWith('image/') || Boolean(dimensions),
    dimensions,
    quality: scorePanelQuality(dimensions),
  };
}
