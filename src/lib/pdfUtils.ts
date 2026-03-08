import * as pdfjsLib from "pdfjs-dist";

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs`;

/**
 * Renders the first page of a PDF file as a base64-encoded PNG image.
 * Returns { base64, mimeType } ready for the analyze-plan edge function.
 */
export async function pdfToImage(
  file: File,
  options?: { pageNumber?: number; scale?: number }
): Promise<{ base64: string; mimeType: string }> {
  const { pageNumber = 1, scale = 2 } = options || {};

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
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}
