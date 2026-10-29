// Letters that arrive as a picture instead of a PDF (a phone photo or a screenshot attached to the e-mail).
export type ImageInfo = { mime: "image/png" | "image/jpeg"; ext: "png" | "jpg"; width: number; height: number };

export function sniffImage(b: Uint8Array): ImageInfo | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { mime: "image/png", ext: "png", width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      const len = v.getUint16(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { mime: "image/jpeg", ext: "jpg", width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
      i += 2 + len;
    }
    return { mime: "image/jpeg", ext: "jpg", width: 0, height: 0 };
  }
  return null;
}
