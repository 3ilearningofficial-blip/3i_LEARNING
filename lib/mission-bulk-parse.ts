import { Platform } from "react-native";
import { getApiUrl, prepareAuthorizedFetchHeaders } from "@/lib/query-client";

export type MissionBulkQuestion = {
  question: string;
  options: string[];
  correct: string;
  topic: string;
  subtopic: string;
  marks: string;
  solution: string;
  image_url: string;
  solution_image_url: string;
};

type ParsedBulkQuestion = {
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: string;
  explanation?: string;
};

export function parsedBulkToMissionQuestion(q: ParsedBulkQuestion): MissionBulkQuestion {
  return {
    question: q.questionText,
    options: [q.optionA, q.optionB, q.optionC, q.optionD],
    correct: q.correctOption || "A",
    topic: "",
    subtopic: "",
    marks: "",
    solution: q.explanation || "",
    image_url: "",
    solution_image_url: "",
  };
}

export async function parseMissionQuestionsPdf(file: { uri?: string; name?: string } | File): Promise<MissionBulkQuestion[]> {
  const baseUrl = getApiUrl();
  const url = new URL("/api/admin/questions/parse-pdf", baseUrl);
  const formData = new FormData();
  if (Platform.OS === "web") {
    formData.append("pdf", file as File);
  } else {
    const name = (file as { name?: string }).name || "questions.pdf";
    formData.append("pdf", {
      uri: (file as { uri: string }).uri,
      name,
      type: "application/pdf",
    } as any);
  }
  const { headers } = await prepareAuthorizedFetchHeaders();
  const res = await globalThis.fetch(url.toString(), { method: "POST", headers, body: formData, credentials: "include" });
  const data = await res.json().catch(() => ({ message: `Server error ${res.status}` }));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Upload failed (${res.status})`);
  }
  const questions: ParsedBulkQuestion[] = Array.isArray(data?.questions) ? data.questions : [];
  if (!questions.length) {
    throw new Error("No questions found in PDF");
  }
  return questions.map(parsedBulkToMissionQuestion);
}
