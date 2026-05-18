export type PdfSlideInput = {
  blob: Blob;
  width: number;
  height: number;
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image for PDF"));
    reader.readAsDataURL(blob);
  });
}

/** Single PNG → one-page PDF (legacy helper). */
export async function pngBlobToPdfBlob(png: Blob, widthPx: number, heightPx: number): Promise<Blob> {
  return pngSlidesToPdfBlob([{ blob: png, width: widthPx, height: heightPx }]);
}

/** One PNG per board page → multi-page PDF (same slide size per page when dimensions match). */
export async function pngSlidesToPdfBlob(slides: PdfSlideInput[]): Promise<Blob> {
  if (slides.length === 0) {
    throw new Error("No slides to export");
  }

  const { jsPDF } = await import("jspdf");
  let pdf: InstanceType<typeof jsPDF> | null = null;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const w = Math.max(1, Math.round(slide.width));
    const h = Math.max(1, Math.round(slide.height));
    const dataUrl = await blobToDataUrl(slide.blob);
    const orientation = w >= h ? "landscape" : "portrait";

    if (i === 0) {
      pdf = new jsPDF({
        orientation,
        unit: "px",
        format: [w, h],
        hotfixes: ["px_scaling"],
      });
    } else {
      pdf!.addPage([w, h], orientation);
    }
    pdf!.addImage(dataUrl, "PNG", 0, 0, w, h, undefined, "FAST");
  }

  return pdf!.output("blob");
}
