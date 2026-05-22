import type { TLAsset, TLAssetStore } from "tldraw";
import { uploadToR2, getMimeType } from "@/lib/r2-upload";

export function createClassroomAssetStore(liveClassId: string): TLAssetStore {
  return {
    async upload(_asset: TLAsset, file: File) {
      const filename = `classroom-asset-${liveClassId}-${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const objectUrl = URL.createObjectURL(file);
      try {
        const { publicUrl } = await uploadToR2(
          objectUrl,
          filename,
          file.type || getMimeType(filename),
          "live-class-recording",
          undefined,
          "/api/upload/presign"
        );
        return { src: publicUrl };
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    resolve(asset: TLAsset) {
      return asset.props.src;
    },
  };
}
