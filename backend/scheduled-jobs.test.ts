import { describe, expect, it } from "vitest";
import {
  LIVE_CLASS_REMINDER_MS,
  liveClassReminderRunAt,
  shouldScheduleLiveClassReminder,
} from "./scheduled-jobs";

describe("scheduled-jobs live class reminders", () => {
  const now = 1_700_000_000_000;

  it("computes run_at 30 minutes before class start", () => {
    const scheduledAt = now + 2 * 60 * 60 * 1000;
    expect(liveClassReminderRunAt(scheduledAt)).toBe(scheduledAt - LIVE_CLASS_REMINDER_MS);
  });

  it("schedules when bell on and class is in the future", () => {
    expect(
      shouldScheduleLiveClassReminder(
        {
          id: 1,
          title: "Physics",
          course_id: 10,
          scheduled_at: now + 60 * 60 * 1000,
          notify_bell: true,
          is_completed: false,
          is_live: false,
          is_recording_mode: false,
          is_free_preview: false,
          is_public: false,
        },
        now
      )
    ).toBe(true);
  });

  it("does not schedule without notify_bell", () => {
    expect(
      shouldScheduleLiveClassReminder(
        {
          id: 1,
          title: "Physics",
          course_id: 10,
          scheduled_at: now + 60 * 60 * 1000,
          notify_bell: false,
          is_completed: false,
          is_live: false,
          is_recording_mode: false,
          is_free_preview: false,
          is_public: false,
        },
        now
      )
    ).toBe(false);
  });

  it("does not schedule for past, live, completed, or recording mode classes", () => {
    const base = {
      id: 1,
      title: "Physics",
      course_id: 10,
      scheduled_at: now + 60 * 60 * 1000,
      notify_bell: true,
      is_completed: false,
      is_live: false,
      is_recording_mode: false,
      is_free_preview: false,
      is_public: false,
    };
    expect(shouldScheduleLiveClassReminder({ ...base, scheduled_at: now - 1000 }, now)).toBe(false);
    expect(shouldScheduleLiveClassReminder({ ...base, is_live: true }, now)).toBe(false);
    expect(shouldScheduleLiveClassReminder({ ...base, is_completed: true }, now)).toBe(false);
    expect(shouldScheduleLiveClassReminder({ ...base, is_recording_mode: true }, now)).toBe(false);
  });
});
