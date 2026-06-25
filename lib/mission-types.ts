export interface MissionQuestion {
  id: number;
  question: string;
  options: string[];
  correct: string;
  topic: string;
  subtopic?: string;
  marks?: number;
  time_limit?: number;
  solution?: string;
  image_url?: string;
  solution_image_url?: string;
}

export interface DailyMission {
  id: number;
  title: string;
  description: string;
  questions: MissionQuestion[];
  mission_type: string;
  mission_date: string;
  course_id?: number;
  course_title?: string | null;
  category?: string;
  folder_name?: string | null;
  subject_key?: string | null;
  xp_reward?: number;
  isCompleted?: boolean;
  userScore?: number;
  userTimeTaken?: number;
  userAnswers?: Record<number, string>;
  userIncorrect?: number;
  userSkipped?: number;
  isAccessible?: boolean;
}

export type MissionScreen = "start" | "quiz" | "result" | "review";

export type MissionSessionResult = {
  score: number;
  timeTaken: number;
  answers: Record<number, string>;
  incorrect: number;
  skipped: number;
};

export function normalizeTopicLabel(s: unknown): string {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

export function uniqueTopicsAndSubtopicsFromQuestions(questions: MissionQuestion[]): {
  topics: string[];
  subtopics: string[];
} {
  const topicKeys = new Set<string>();
  const topics: string[] = [];
  for (const q of questions) {
    const t = normalizeTopicLabel(q.topic);
    if (!t) continue;
    const k = t.toLowerCase();
    if (topicKeys.has(k)) continue;
    topicKeys.add(k);
    topics.push(t);
  }
  const subtopicKeys = new Set<string>();
  const subtopics: string[] = [];
  for (const q of questions) {
    const st = normalizeTopicLabel(q.subtopic);
    if (!st) continue;
    const k = st.toLowerCase();
    if (topicKeys.has(k) || subtopicKeys.has(k)) continue;
    subtopicKeys.add(k);
    subtopics.push(st);
  }
  return { topics, subtopics };
}

export function formatMissionDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatMissionTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function normalizeMissionQuestion(raw: any): MissionQuestion {
  const arr = Array.isArray(raw?.options) ? raw.options : [];
  const fromLegacy = [
    raw?.option_a ?? raw?.optionA ?? "",
    raw?.option_b ?? raw?.optionB ?? "",
    raw?.option_c ?? raw?.optionC ?? "",
    raw?.option_d ?? raw?.optionD ?? "",
  ];
  const options = (arr.length > 0 ? arr : fromLegacy).map((v: unknown) => String(v ?? ""));
  while (options.length < 4) options.push("");
  return {
    ...raw,
    id: Number(raw?.id ?? 0),
    question: String(raw?.question ?? raw?.question_text ?? ""),
    options: options.slice(0, 4),
    correct: String(raw?.correct ?? raw?.correct_option ?? "").toUpperCase(),
    topic: String(raw?.topic ?? ""),
    subtopic: String(raw?.subtopic ?? ""),
    marks: Number(raw?.marks ?? 0) || 0,
    time_limit: Number(raw?.time_limit ?? 0) || 0,
    solution: String(raw?.solution ?? raw?.explanation ?? ""),
    image_url: raw?.image_url ? String(raw.image_url) : undefined,
    solution_image_url: raw?.solution_image_url ? String(raw.solution_image_url) : undefined,
  };
}

export function normalizeMission(raw: any): DailyMission {
  return {
    ...raw,
    questions: Array.isArray(raw?.questions) ? raw.questions.map(normalizeMissionQuestion) : [],
  };
}

export function isMissionCompleted(
  mission: DailyMission,
  completedThisSession?: Set<number>,
): boolean {
  return (
    !!mission.isCompleted ||
    !!completedThisSession?.has(mission.id) ||
    (mission.userScore !== undefined && mission.userScore > 0)
  );
}

export function missionHasRealQuestions(mission: DailyMission | any): boolean {
  const qs = Array.isArray(mission?.questions) ? mission.questions : [];
  return qs.some((q: any) => String(q?.question || "").trim().length > 0);
}
