-- Comprehensive baseline migration extracted from legacy startup schema/bootstrap logic.
-- Safe to re-run on existing environments.

ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT FALSE;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Mathematics';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'Beginner';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(5, 1) DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_lectures INTEGER DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_tests INTEGER DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS original_price DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS validity_months NUMERIC(8, 2) DEFAULT NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_type TEXT DEFAULT 'live';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS start_date TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS end_date TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_students INTEGER DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_materials INTEGER DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS pyq_count INTEGER DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS mock_count INTEGER DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS practice_count INTEGER DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS thumbnail TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_color TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE tests ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'moderate';
ALTER TABLE tests ADD COLUMN IF NOT EXISTS scheduled_at BIGINT;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS mini_course_id INTEGER;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) DEFAULT 0;

ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS solution_image_url TEXT;

ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS correct INTEGER DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS incorrect INTEGER DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS attempted INTEGER DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS question_times JSONB;

ALTER TABLE lectures ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE;
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS section_title TEXT;
ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE;
ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS section_title TEXT;
ALTER TABLE user_downloads ADD COLUMN IF NOT EXISTS local_filename TEXT;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'system';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at BIGINT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS admin_notif_id INTEGER;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT FALSE;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS notify_bell BOOLEAN DEFAULT FALSE;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS is_free_preview BOOLEAN DEFAULT FALSE;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS started_at BIGINT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS ended_at BIGINT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 0;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS chat_mode TEXT DEFAULT 'public';
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_stream_uid TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_stream_key TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_stream_rtmp_url TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_playback_hls TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS lecture_section_title TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS lecture_subfolder_title TEXT;

CREATE TABLE IF NOT EXISTS test_purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  UNIQUE(user_id, test_id)
);

CREATE TABLE IF NOT EXISTS course_folders (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_hidden BOOLEAN DEFAULT FALSE,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  UNIQUE(course_id, name, type)
);

CREATE TABLE IF NOT EXISTS standalone_folders (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_hidden BOOLEAN DEFAULT FALSE,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  UNIQUE(name, type)
);

ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) DEFAULT 0;
ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS original_price NUMERIC(10,2) DEFAULT 0;
ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT TRUE;
ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS validity_months NUMERIC(8,2) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS folder_purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES standalone_folders(id) ON DELETE CASCADE,
  amount NUMERIC(10,2),
  payment_id TEXT,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  UNIQUE(user_id, folder_id)
);

CREATE TABLE IF NOT EXISTS question_reports (
  id SERIAL PRIMARY KEY,
  question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  created_at BIGINT,
  UNIQUE(question_id, user_id)
);

CREATE TABLE IF NOT EXISTS books (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  author TEXT,
  price NUMERIC DEFAULT 0,
  original_price NUMERIC DEFAULT 0,
  cover_url TEXT,
  file_url TEXT,
  is_published BOOLEAN DEFAULT TRUE,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

ALTER TABLE books ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS book_purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  book_id INTEGER REFERENCES books(id),
  purchased_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  UNIQUE(user_id, book_id)
);

CREATE TABLE IF NOT EXISTS book_click_tracking (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  click_count INTEGER DEFAULT 1,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  UNIQUE(user_id, book_id)
);

CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'admin')),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

CREATE TABLE IF NOT EXISTS admin_notifications (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'all',
  course_id INTEGER,
  sent_count INTEGER DEFAULT 0,
  is_hidden BOOLEAN DEFAULT FALSE,
  image_url TEXT,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_tests_course_id ON tests(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_test_attempts_user_test ON test_attempts(user_id, test_id);
CREATE INDEX IF NOT EXISTS idx_test_attempts_test_id ON test_attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_lecture_progress_user ON lecture_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_questions_test_id ON questions(test_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS lecture_progress_user_lecture ON lecture_progress(user_id, lecture_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_user_course_unique ON payments(user_id, course_id);
