import type { QueryClient } from "@tanstack/react-query";
import { invalidateAccessCaches } from "@/lib/invalidate-access-caches";
import type { DailyMission } from "@/lib/mission-types";

export type MissionCompletePatch = {
  missionId: number;
  score: number;
  timeTaken: number;
  answers: Record<number, string>;
  incorrect: number;
  skipped: number;
  courseId?: number | null;
};

export function patchMissionListCaches(qc: QueryClient, data: MissionCompletePatch): void {
  const patchFn = (old: DailyMission[] | undefined) => {
    if (!old) return old;
    return old.map((m) =>
      m.id === data.missionId
        ? {
            ...m,
            isCompleted: true,
            userScore: data.score,
            userTimeTaken: data.timeTaken,
            userAnswers: data.answers as any,
            userIncorrect: data.incorrect,
            userSkipped: data.skipped,
          }
        : m,
    );
  };

  ["all", "daily_drill", "free_practice"].forEach((tab) => {
    qc.setQueryData<DailyMission[]>(["/api/daily-missions", tab], patchFn);
  });

  qc.getQueryCache().findAll({ queryKey: ["/api/daily-missions", "course"] }).forEach((query) => {
    qc.setQueryData(query.queryKey, patchFn);
  });

  qc.invalidateQueries({ queryKey: ["/api/daily-missions"] });
  qc.invalidateQueries({ queryKey: ["/api/daily-missions/folder"] });

  let courseId = data.courseId ?? null;
  if (courseId == null || !Number.isFinite(Number(courseId))) {
    const findCourseId = (key: unknown) => {
      const list = qc.getQueryData<DailyMission[]>(key as any);
      return list?.find((m) => m.id === data.missionId)?.course_id;
    };
    courseId =
      findCourseId(["/api/daily-missions", "all"]) ??
      findCourseId(["/api/daily-missions", "daily_drill"]) ??
      findCourseId(["/api/daily-missions", "free_practice"]) ??
      null;
  }

  invalidateAccessCaches(qc, { courseId: courseId ?? null });
}
