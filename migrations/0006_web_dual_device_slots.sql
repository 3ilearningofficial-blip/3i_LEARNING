-- Two stable web browser installations per student: phone-class vs desktop-class web.
-- Admins are exempt (see server/native-device-binding.ts). Native apps still use app_bound_device_id.
ALTER TABLE users ADD COLUMN IF NOT EXISTS web_device_id_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS web_device_id_desktop TEXT;
