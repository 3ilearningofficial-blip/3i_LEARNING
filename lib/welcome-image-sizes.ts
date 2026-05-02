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
