import React from "react";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

export type SubjectIconLib = "ion" | "mci";

export type MultiSubject = {
  key: string;
  label: string;
  iconLib: SubjectIconLib;
  icon: string;
  color: string;
  bg: string;
};

// Canonical multi-subject set + order. Used by the student subject grid,
// the admin multi-subject tabs/content, and the subject detail screen so all
// stay in sync. Keys are stored on content rows as `subject_key`.
export const MULTI_SUBJECTS: MultiSubject[] = [
  { key: "maths", label: "Maths", iconLib: "ion", icon: "calculator", color: "#EF4444", bg: "#FEF2F2" },
  { key: "english", label: "English", iconLib: "ion", icon: "book", color: "#2563EB", bg: "#EFF6FF" },
  { key: "physics", label: "Physics", iconLib: "mci", icon: "atom", color: "#6366F1", bg: "#EEF2FF" },
  { key: "chemistry", label: "Chemistry", iconLib: "mci", icon: "flask", color: "#7C3AED", bg: "#F5F3FF" },
  { key: "biology", label: "Biology", iconLib: "mci", icon: "dna", color: "#16A34A", bg: "#F0FDF4" },
  { key: "geography", label: "Geography", iconLib: "ion", icon: "earth", color: "#0891B2", bg: "#ECFEFF" },
  { key: "polity", label: "Polity/Civics", iconLib: "mci", icon: "bank", color: "#D97706", bg: "#FFFBEB" },
  { key: "history", label: "History", iconLib: "ion", icon: "hourglass", color: "#92400E", bg: "#FEF3C7" },
  { key: "economics", label: "Economics", iconLib: "ion", icon: "cash", color: "#059669", bg: "#ECFDF5" },
  { key: "current_affairs", label: "Current Affairs", iconLib: "ion", icon: "newspaper", color: "#475569", bg: "#F1F5F9" },
];

// Legacy keys that may still exist on old content (before the subject list
// expanded). Used to give them a friendly label/icon if they appear.
const LEGACY_SUBJECTS: MultiSubject[] = [
  { key: "science", label: "Science", iconLib: "ion", icon: "flask", color: "#16A34A", bg: "#F0FDF4" },
  { key: "gk", label: "G.K", iconLib: "ion", icon: "earth", color: "#0891B2", bg: "#ECFEFF" },
];

const ALL_SUBJECTS = [...MULTI_SUBJECTS, ...LEGACY_SUBJECTS];

export function getSubjectMeta(key: string): MultiSubject {
  const k = String(key || "").toLowerCase();
  const found = ALL_SUBJECTS.find((s) => s.key === k);
  if (found) return found;
  const label = k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ") : "Other";
  return { key: k, label, iconLib: "ion", icon: "albums", color: "#64748B", bg: "#F1F5F9" };
}

export const SUBJECT_LABELS: Record<string, string> = ALL_SUBJECTS.reduce(
  (acc, s) => { acc[s.key] = s.label; return acc; },
  {} as Record<string, string>
);

export function SubjectIcon({
  subject,
  size,
  color,
}: {
  subject: Pick<MultiSubject, "iconLib" | "icon" | "color">;
  size: number;
  color?: string;
}) {
  const tint = color ?? subject.color;
  if (subject.iconLib === "mci") {
    return <MaterialCommunityIcons name={subject.icon as any} size={size} color={tint} />;
  }
  return <Ionicons name={subject.icon as any} size={size} color={tint} />;
}
