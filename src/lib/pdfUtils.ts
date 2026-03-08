/**
 * Dynamically loads pdf.js from CDN and renders a PDF page as a base64 PNG.
 * Avoids the top-level await issue with the npm pdfjs-dist package.
 */

let pdfjsLoaded: Promise<any> | null = null;

function loadPdfJs(): Promise<any> {
  if (pdfjsLoaded) return pdfjsLoaded;

  pdfjsLoaded = new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (!lib) {
        reject(new Error("pdf.js failed to load"));
        return;
      }
      lib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(lib);
    };
    script.onerror = () => {
      pdfjsLoaded = null;
      reject(new Error("Failed to load pdf.js from CDN"));
    };
    document.head.appendChild(script);
  });

  return pdfjsLoaded;
}

/**
 * Renders a page of a PDF file as a base64-encoded PNG image.
 */
export async function pdfToImage(
  file: File,
  options?: { pageNumber?: number; scale?: number }
): Promise<{ base64: string; mimeType: string }> {
  const { pageNumber = 1, scale = 2 } = options || {};

  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  if (pageNumber > pdf.numPages) {
    throw new Error(`Le PDF n'a que ${pdf.numPages} page(s)`);
  }

  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Impossible de créer le contexte canvas");

  await page.render({ canvasContext: ctx, viewport }).promise;

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  canvas.remove();

  return { base64, mimeType: "image/png" };
}

/**
 * Returns the number of pages in a PDF file.
 */
export async function getPdfPageCount(file: File): Promise<number> {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}
