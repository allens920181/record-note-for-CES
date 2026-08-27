import type { PDFDocumentProxy } from 'pdfjs-dist'

// pdf.js and its worker are well over a megabyte, and most study sessions never
// open a PDF — so it is pulled in on first use rather than at startup.
//
// Pinned to 5.4.x on purpose. From 5.5 onward pdf.js calls
// Map/WeakMap.prototype.getOrInsertComputed, a very recent proposal method that
// Chromium 141 does not have — rendering throws while text extraction quietly
// still works, so the viewer shows a blank page with no error. It is used on
// both the main thread and inside the worker, so polyfilling would mean
// patching two scopes. Check browser support before bumping this.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [mod, worker] = await Promise.all([
        import('pdfjs-dist'),
        // Safe under ?url, unlike the ffmpeg worker: pdf.worker.min.mjs is a
        // self-contained bundle with no relative imports to resolve at runtime.
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
      mod.GlobalWorkerOptions.workerSrc = new URL(worker.default, location.href).href
      return mod
    })()
  }
  return pdfjsPromise
}

export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs()
  return pdfjs.getDocument({ data }).promise
}

export interface ExtractedPdf {
  text: string
  pageCount: number
}

/**
 * Pulls the text layer out of a PDF so handouts join the cross-week search in
 * Phase 3. Scanned PDFs have no text layer and come back empty — that is the
 * honest answer, not a failure.
 */
export async function extractPdfText(file: File): Promise<ExtractedPdf> {
  const doc = await loadPdf(await file.arrayBuffer())
  const pages: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const line = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      if (line) pages.push(line)
      page.cleanup()
    }
    return { text: pages.join('\n\n'), pageCount: doc.numPages }
  } finally {
    await doc.destroy()
  }
}
