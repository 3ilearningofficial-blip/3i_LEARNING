/** Fixed 16:9 teaching slide (matches composite stream and exports). */
export const SLIDE_ASPECT = 16 / 9;
export const SLIDE_LOGICAL_W = 1920;
export const SLIDE_LOGICAL_H = 1080;

export const COMPOSITE_WIDTH = 1920;
export const COMPOSITE_HEIGHT = 1080;

export const SLIDE_FRAME_DATA_ATTR = "data-classroom-slide-frame";

export const EXPORT_SCALE = 2;

export function getSlideBounds() {
  return { x: 0, y: 0, w: SLIDE_LOGICAL_W, h: SLIDE_LOGICAL_H };
}

export function getExportPixelSize() {
  return {
    width: SLIDE_LOGICAL_W * EXPORT_SCALE,
    height: SLIDE_LOGICAL_H * EXPORT_SCALE,
  };
}
