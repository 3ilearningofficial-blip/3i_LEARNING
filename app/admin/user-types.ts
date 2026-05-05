export interface UserRecord {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: string;
  created_at: number;
  is_blocked: boolean;
  last_active_at: number;
}

export interface DeviceBlockEventRow {
  id: number;
  user_id: number;
  attempted_device_id: string | null;
  bound_device_id: string | null;
  phone: string | null;
  email: string | null;
  platform: string | null;
  reason: string | null;
  created_at: number;
  user_name: string | null;
}

/** One row per student from GET /api/admin/device-denied-users (latest device-lock denial). */
export interface DeviceDeniedUserRow {
  user_id: number;
  user_name: string | null;
  phone: string | null;
  email: string | null;
  latest_at: number;
  event_count: number;
  latest_reason: string | null;
  latest_platform: string | null;
}
