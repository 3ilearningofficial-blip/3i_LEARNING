import type { Editor } from "tldraw";
import { AssetRecordType, createShapeId } from "tldraw";
import { uploadToR2, getMimeType } from "@/lib/r2-upload";
import { SLIDE_LOGICAL_H, SLIDE_LOGICAL_W } from "./slideConstants";

/** Upload image to R2 and place as full-slide background on the current page. */
export async function importImageToCurrentSlide(
  editor: Editor,
  file: File,
  liveClassId: string
): Promise<void> {
  const filename = `classroom-slide-bg-${liveClassId}-${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const objectUrl = URL.createObjectURL(file);
  let publicUrl: string;
  try {
    const uploaded = await uploadToR2(
      objectUrl,
      filename,
      file.type || getMimeType(filename),
      "live-class-recording",
      undefined,
      "/api/upload/presign"
    );
    publicUrl = uploaded.publicUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const assetId = AssetRecordType.createId();
  const img = await loadImageDimensions(publicUrl);
  const scale = Math.min(SLIDE_LOGICAL_W / img.w, SLIDE_LOGICAL_H / img.h, 1);
  const w = img.w * scale;
  const h = img.h * scale;
  const x = (SLIDE_LOGICAL_W - w) / 2;
  const y = (SLIDE_LOGICAL_H - h) / 2;

  editor.createAssets([
    {
      id: assetId,
      type: "image",
      typeName: "asset",
      props: {
        name: file.name,
        src: publicUrl,
        w: img.w,
        h: img.h,
        mimeType: file.type || "image/png",
        isAnimated: false,
      },
      meta: {},
    },
  ]);

  editor.createShapes([
    {
      id: createShapeId(),
      type: "image",
      x,
      y,
      props: {
        assetId,
        w,
        h,
      },
    },
  ]);
}

function loadImageDimensions(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = url;
  });
}
