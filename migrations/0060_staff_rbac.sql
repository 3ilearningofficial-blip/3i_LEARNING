-- Migration 0060: Staff RBAC — profiles, assignments, permissions, requests, activity log

CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employee_id TEXT,
  teacher_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  personal_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  working_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  bank_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  company_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  photo_url TEXT,
  resume_url TEXT,
  aadhar_number TEXT,
  aadhar_front_url TEXT,
  aadhar_back_url TEXT,
  joining_date BIGINT,
  reporting_manager TEXT,
  department TEXT,
  designation TEXT,
  created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE TABLE IF NOT EXISTS staff_education (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  degree TEXT,
  institute TEXT,
  board TEXT,
  university TEXT,
  passing_year TEXT,
  percentage TEXT,
  certificate_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_staff_education_user ON staff_education (user_id, sort_order);

CREATE TABLE IF NOT EXISTS staff_experience (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institute_name TEXT,
  designation TEXT,
  subjects TEXT,
  years_experience TEXT,
  joining_date TEXT,
  leaving_date TEXT,
  experience_letter_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_staff_experience_user ON staff_experience (user_id, sort_order);

CREATE TABLE IF NOT EXISTS staff_course_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  subject_key TEXT,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_course_assignments_scope
  ON staff_course_assignments (user_id, course_id, (COALESCE(subject_key, '')))
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_staff_course_assignments_user ON staff_course_assignments (user_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_staff_course_assignments_course ON staff_course_assignments (course_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS staff_permission_overrides (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  UNIQUE (user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS staff_access_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at BIGINT,
  created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_staff_access_requests_user ON staff_access_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_access_requests_status ON staff_access_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_activity_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  subject_key TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_staff_activity_log_user ON staff_activity_log (user_id, created_at DESC);
