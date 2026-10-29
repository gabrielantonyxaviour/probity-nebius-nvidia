// Page rasteriser: PDFium compiled to WASM (works inside a Worker, no native binaries). The caller supplies the wasm
// (a compiled WebAssembly.Module in workerd, raw bytes in Node) so this file never imports a .wasm itself.
import { PDFiumLibrary } from "@hyzyla/pdfium";

export type PdfiumWasm = WebAssembly.Module | Uint8Array;

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row by row from the top. */
  rgba: Uint8Array;
  /** pixels per PDF point */
  scale: number;
  pageWidth: number;
  pageHeight: number;
}

export async function openRenderer(wasm: PdfiumWasm) {
  const lib = await PDFiumLibrary.init(
    wasm instanceof Uint8Array
      ? { wasmBinary: wasm }
      : {
          instantiateWasm: (imports, done) => {
            WebAssembly.instantiate(wasm, imports).then((instance) => done(instance, wasm));
            return {};
          },
        },
  );
  return lib;
}

/** Renders pages one at a time (about 8 MB RGBA each at scale 2) and hands each to `onPage`; nothing is kept. */
export async function renderPages(
  lib: Awaited<ReturnType<typeof openRenderer>>,
  bytes: Uint8Array,
  opts: { scale: number; maxPages: number },
  onPage: (pageIndex: number, raster: Raster) => Promise<void>,
): Promise<number> {
  const doc = await lib.loadDocument(bytes);
  try {
    const count = Math.min(doc.getPageCount(), opts.maxPages);
    for (let i = 0; i < count; i++) {
      const page = doc.getPage(i);
      try {
        const r = await page.render({ scale: opts.scale, render: "bitmap", renderFormFields: true });
        await onPage(i, {
          width: r.width,
          height: r.height,
          rgba: r.data,
          scale: r.width / r.originalWidth,
          pageWidth: r.originalWidth,
          pageHeight: r.originalHeight,
        });
      } finally {
        page.close();
      }
    }
    return doc.getPageCount();
  } finally {
    doc.destroy();
  }
}
