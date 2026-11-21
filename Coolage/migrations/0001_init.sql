CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS school_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  login_id TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('student','staff','admin')),
  name TEXT NOT NULL,
  class_name TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  needs_password_change INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(school_id, login_id)
);
CREATE INDEX IF NOT EXISTS idx_users_school_role ON users(school_id,role);
CREATE INDEX IF NOT EXISTS idx_users_school_class ON users(school_id,class_name,section);

CREATE TABLE IF NOT EXISTS staff_classes (
  staff_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_name TEXT NOT NULL,
  section TEXT NOT NULL,
  PRIMARY KEY(staff_id,class_name,section)
);
CREATE INDEX IF NOT EXISTS idx_staff_classes_school ON staff_classes(school_id,class_name,section);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS homework (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_name TEXT NOT NULL,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  due_date TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(school_id,class_name,section,created_at);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_name TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_school ON announcements(school_id,created_at);

CREATE TABLE IF NOT EXISTS attendance (
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','absent')),
  marked_by TEXT NOT NULL REFERENCES users(id),
  marked_at INTEGER NOT NULL,
  PRIMARY KEY(student_id,date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance(school_id,date);
