/**
 * Display sizes on the public welcome page (logical dp / px). Keep in sync with `app/welcome.tsx` StyleSheet.
 * Used by Admin → Welcome for editor hints only.
 */

export const WELCOME_LOGO_DISPLAY_ADMIN_HINT =
  "Displayed in a circular frame: inner image area 60×60 (laptop & native apps), 66×66 on phone web; outer ring about 72×72 (about 78×78 on phone web). Square source images (~512×512 or larger) look best.";

export const WELCOME_PANKAJ_PHOTO_ADMIN_HINT =
  "Displayed as a 130×130 circle. Use a square portrait (e.g. 400×400 px or larger) for best fit.";

export const WELCOME_SECTION_IMAGE_ADMIN_HINT =
  "Full width of the content card × 200 dp height, cropped with cover. Wide landscape images (e.g. 1200×600+) work well.";

export const WELCOME_BANNER_MOBILE_ADMIN_HINT =
  "Phone web & native: full viewport width × ~27% of width (1200×440 source, ~2.73:1). Slightly taller than the previous 400px strip.";

export const WELCOME_BANNER_DESKTOP_ADMIN_HINT =
  "Laptop web (≥768px): full width × up to 230px tall (1920×230 source). Auto-advances every 2s; arrows on wide web only.";
