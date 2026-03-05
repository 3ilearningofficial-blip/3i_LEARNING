import { pgTable, serial, text, boolean, integer, decimal, bigint, jsonb, date } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default(""),
  email: text("email").unique(),
  phone: text("phone").unique(),
  role: text("role").notNull().default("student"),
  deviceId: text("device_id"),
  otp: text("otp"),
  otpExpiresAt: bigint("otp_expires_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }),
});

export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  teacherName: text("teacher_name").notNull().default("3i Learning"),
  price: decimal("price", { precision: 10, scale: 2 }).default("0"),
  originalPrice: decimal("original_price", { precision: 10, scale: 2 }).default("0"),
  category: text("category").default("Mathematics"),
  thumbnail: text("thumbnail"),
  isFree: boolean("is_free").default(false),
  totalLectures: integer("total_lectures").default(0),
  totalTests: integer("total_tests").default(0),
  totalStudents: integer("total_students").default(0),
  level: text("level").default("Beginner"),
  durationHours: decimal("duration_hours", { precision: 5, scale: 1 }).default("0"),
  isPublished: boolean("is_published").default(true),
  courseType: text("course_type").default("standard"),
  createdAt: bigint("created_at", { mode: "number" }),
});

export const lectures = pgTable("lectures", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id"),
  title: text("title").notNull(),
  description: text("description"),
  videoUrl: text("video_url"),
  videoType: text("video_type").default("youtube"),
  pdfUrl: text("pdf_url"),
  durationMinutes: integer("duration_minutes").default(0),
  orderIndex: integer("order_index").default(0),
  isFreePreview: boolean("is_free_preview").default(false),
  sectionTitle: text("section_title"),
  createdAt: bigint("created_at", { mode: "number" }),
});

export const enrollments = pgTable("enrollments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  courseId: integer("course_id"),
  progressPercent: integer("progress_percent").default(0),
  lastLectureId: integer("last_lecture_id"),
  enrolledAt: bigint("enrolled_at", { mode: "number" }),
});

export const lectureProgress = pgTable("lecture_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  lectureId: integer("lecture_id"),
  isCompleted: boolean("is_completed").default(false),
  watchPercent: integer("watch_percent").default(0),
  completedAt: bigint("completed_at", { mode: "number" }),
});

export const studyMaterials = pgTable("study_materials", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  fileUrl: text("file_url"),
  fileType: text("file_type").default("pdf"),
  courseId: integer("course_id"),
  isFree: boolean("is_free").default(true),
  sectionTitle: text("section_title"),
  createdAt: bigint("created_at", { mode: "number" }),
});

export const tests = pgTable("tests", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  courseId: integer("course_id"),
  durationMinutes: integer("duration_minutes").default(60),
  totalQuestions: integer("total_questions").default(0),
  totalMarks: integer("total_marks").default(100),
  passingMarks: integer("passing_marks").default(35),
  testType: text("test_type").default("practice"),
  isPublished: boolean("is_published").default(true),
  createdAt: bigint("created_at", { mode: "number" }),
});

export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  testId: integer("test_id"),
  questionText: text("question_text").notNull(),
  optionA: text("option_a").notNull(),
  optionB: text("option_b").notNull(),
  optionC: text("option_c").notNull(),
  optionD: text("option_d").notNull(),
  correctOption: text("correct_option").notNull(),
  explanation: text("explanation"),
  topic: text("topic"),
  difficulty: text("difficulty").default("medium"),
  marks: integer("marks").default(4),
  negativeMarks: decimal("negative_marks", { precision: 3, scale: 1 }).default("1"),
  orderIndex: integer("order_index").default(0),
});

export const testAttempts = pgTable("test_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  testId: integer("test_id"),
  answers: jsonb("answers").default({}),
  score: integer("score").default(0),
  totalMarks: integer("total_marks").default(0),
  percentage: decimal("percentage", { precision: 5, scale: 2 }).default("0"),
  timeTakenSeconds: integer("time_taken_seconds").default(0),
  status: text("status").default("in_progress"),
  startedAt: bigint("started_at", { mode: "number" }),
  completedAt: bigint("completed_at", { mode: "number" }),
});

export const dailyMissions = pgTable("daily_missions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  questions: jsonb("questions").default([]),
  missionDate: date("mission_date"),
  xpReward: integer("xp_reward").default(50),
});

export const userMissions = pgTable("user_missions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  missionId: integer("mission_id"),
  isCompleted: boolean("is_completed").default(false),
  score: integer("score").default(0),
  completedAt: bigint("completed_at", { mode: "number" }),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").default("info"),
  isRead: boolean("is_read").default(false),
  createdAt: bigint("created_at", { mode: "number" }),
});

export const liveClasses = pgTable("live_classes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  courseId: integer("course_id"),
  youtubeUrl: text("youtube_url"),
  scheduledAt: bigint("scheduled_at", { mode: "number" }),
  isLive: boolean("is_live").default(false),
  isCompleted: boolean("is_completed").default(false),
  createdAt: bigint("created_at", { mode: "number" }),
});

export const doubts = pgTable("doubts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  question: text("question").notNull(),
  answer: text("answer"),
  topic: text("topic"),
  status: text("status").default("pending"),
  createdAt: bigint("created_at", { mode: "number" }),
});

export type User = typeof users.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Lecture = typeof lectures.$inferSelect;
export type Enrollment = typeof enrollments.$inferSelect;
export type Test = typeof tests.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type TestAttempt = typeof testAttempts.$inferSelect;
export type DailyMission = typeof dailyMissions.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type LiveClass = typeof liveClasses.$inferSelect;
export type StudyMaterial = typeof studyMaterials.$inferSelect;
export type Doubt = typeof doubts.$inferSelect;
