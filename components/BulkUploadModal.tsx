import React, { useState } from "react";
import {
  View, Text, Modal, ScrollView, Pressable, TextInput,
  ActivityIndicator, Platform, Alert, StyleSheet, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { getApiUrl, apiRequest } from "@/lib/query-client";

interface ParsedQuestion {
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: string;
  explanation: string;
  imageUrl: string;
  solutionImageUrl: string;
}

interface Props {
  visible: boolean;
  testId: number | null;
  onClose: () => void;
  onSaved: () => void;
  bottomPadding?: number;
}

export default function BulkUploadModal({ visible, testId, onClose, onSaved, bottomPadding = 16 }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"text" | "pdf">("text");
  const [bulkText, setBulkText] = useState("");
  const [parsedQuestions, setParsedQuestions] = useState<ParsedQuestion[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reset = () => {
    setBulkText("");
    setParsedQuestions(null);
    setUploadError(null);
    setSaved(false);
    setMode("text");
  };

  const handleClose = () => { reset(); onClose(); };

  // Parse text — client-side parsing for instant preview, no server round-trip needed
  const parseTextMutation = useMutation({
    mutationFn: async (): Promise<ParsedQuestion[]> => {
      // Parse locally using the same logic as server
      const text = bulkText;
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map((l: string) => l.trim());

      const isQuestion = (l: string) => /^(Q\.?\s*\d+|Q\d+|Question\s*\d+|\d+[\.\)\:])\s*[\.\)\:]?\s*.+/i.test(l);
      const isOption = (l: string) => /^[\(\[]?[AaBbCcDd][\)\]\.\:][\s\)]/.test(l) || /^\([AaBbCcDd]\)/.test(l) || /^[AaBbCcDd]\s*[\.\)]\s*/.test(l);
      const getOptionLetter = (l: string) => { const m = l.match(/^[\(\[]?([AaBbCcDd])[\)\]\.\:]/); if (m) return m[1].toUpperCase(); const m2 = l.match(/^\(([AaBbCcDd])\)/); if (m2) return m2[1].toUpperCase(); return ''; };
      const stripOptionPrefix = (l: string) => l.replace(/^[\(\[]?[AaBbCcDd][\)\]\.\:]\s*/, '').replace(/^\([AaBbCcDd]\)\s*/, '').trim();
      const stripQuestionPrefix = (l: string) => l.replace(/^(Q\.?\s*\d+|Q\d+|Question\s*\d+|\d+)[\.\)\:]?\s*/i, '').trim();
      const isAnswer = (l: string) => /^(Answer|Ans|Correct\s*Answer|Key)[\s\:\.\-]*[:\-]?\s*[\(\[]?[A-Da-d][\)\]]?/i.test(l);
      const getAnswerLetter = (l: string) => { const m = l.match(/[\(\[]?([A-Da-d])[\)\]]?\s*$/); if (m) return m[1].toUpperCase(); const m2 = l.match(/[:\-\s][\(\[]?([A-Da-d])[\)\]]?/i); if (m2) return m2[1].toUpperCase(); return 'A'; };

      const tryInline = (l: string): ParsedQuestion | null => {
        const m = l.match(/^(?:Q\.?\s*\d+[\.\)]?\s*|Q\d+[\.\)]?\s*|\d+[\.\)]\s*)(.+?)\s*[\(\[](A)[\)\]]\s*(.+?)\s*[\(\[](B)[\)\]]\s*(.+?)\s*[\(\[](C)[\)\]]\s*(.+?)\s*[\(\[](D)[\)\]]\s*(.+?)(?:\s*(?:Ans|Answer|Key)[\s:\-]*[\(\[]?([A-Da-d])[\)\]]?)?$/i);
        if (m) return { questionText: m[1].trim(), optionA: m[3].trim(), optionB: m[5].trim(), optionC: m[7].trim(), optionD: m[9].trim(), correctOption: m[10] ? m[10].toUpperCase() : 'A', explanation: '', imageUrl: '', solutionImageUrl: '' };
        return null;
      };

      const result: ParsedQuestion[] = [];
      let curQ = '', opts: Record<string, string> = {}, correct = 'A';
      const flush = () => {
        if (curQ && (opts['A'] || opts['B'])) {
          result.push({ questionText: curQ, optionA: opts['A'] || '', optionB: opts['B'] || '', optionC: opts['C'] || '', optionD: opts['D'] || '', correctOption: correct, explanation: '', imageUrl: '', solutionImageUrl: '' });
        }
        curQ = ''; opts = {}; correct = 'A';
      };

      for (const line of lines) {
        if (!line) continue;
        const inline = tryInline(line);
        if (inline) { flush(); result.push(inline); continue; }
        if (isQuestion(line)) { flush(); curQ = stripQuestionPrefix(line); }
        else if (isOption(line)) { const l = getOptionLetter(line); if (l) opts[l] = stripOptionPrefix(line); }
        else if (isAnswer(line)) { correct = getAnswerLetter(line); }
        else if (curQ && Object.keys(opts).length === 0) { curQ += ' ' + line; }
      }
      flush();

      if (result.length === 0) throw new Error("No questions could be parsed. Check the format and try again.");
      return result;
    },
    onSuccess: (qs) => setParsedQuestions(qs),
    onError: (err: any) => Alert.alert("Parse Error", err.message || "Failed to parse questions"),
  });

  // Parse PDF
  const parsePdfMutation = useMutation({
    mutationFn: async (file: any): Promise<ParsedQuestion[]> => {
      setUploadError(null);
      const baseUrl = getApiUrl();
      const url = new URL("/api/admin/questions/bulk-pdf", baseUrl);
      const formData = new FormData();
      formData.append("testId", String(testId));
      formData.append("defaultMarks", "4");
      formData.append("defaultNegativeMarks", "1");
      if (Platform.OS === "web") {
        formData.append("pdf", file);
      } else {
        const FileSystem = await import("expo-file-system");
        const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: "base64" as any });
        const byteArray = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([byteArray], { type: "application/pdf" });
        formData.append("pdf", blob, file.name || "questions.pdf");
      }
      let token: string | null = null;
      let userId: string | null = null;
      try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
          const stored = localStorage.getItem("user");
          if (stored) { const u = JSON.parse(stored); token = u?.sessionToken || null; userId = u?.id ? String(u.id) : null; }
        } else {
          const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
          const stored = await AsyncStorage.getItem("user");
          if (stored) { const u = JSON.parse(stored); token = u?.sessionToken || null; userId = u?.id ? String(u.id) : null; }
        }
      } catch (_e) {}
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (userId) headers["X-User-Id"] = userId;
      // Use globalThis.fetch — do NOT set Content-Type (browser sets multipart boundary)
      const res = await globalThis.fetch(url.toString(), { method: "POST", headers, body: formData, credentials: "include" });
      const data = await res.json().catch(() => ({ message: `Server error ${res.status}` }));
      const payload = data?.data ?? data;
      if (!res.ok) {
        const msg = data?.error || data?.message || payload?.message || `Upload failed (${res.status})`;
        throw new Error(msg);
      }
      const questions = Array.isArray(payload?.questions) ? payload.questions : [];
      if (!questions.length) {
        throw new Error(
          payload?.rawTextPreview
            ? "PDF parsed, but question format did not match. Use Q-numbering with A/B/C/D options."
            : "No questions found in PDF. Make sure questions are numbered (Q1, 1., etc.) with options A, B, C, D.",
        );
      }
      return questions.map((q: any) => ({ ...q, explanation: q.explanation || "", imageUrl: q.imageUrl || "", solutionImageUrl: q.solutionImageUrl || "" }));
    },
    onSuccess: (qs) => {
      setUploadError(null);
      setParsedQuestions(qs);
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to parse PDF";
      setUploadError(msg);
      Alert.alert("PDF Parse Error", msg);
    },
  });

  // Save edited questions
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/questions/bulk-save", {
        testId, questions: parsedQuestions, defaultMarks: 4, defaultNegativeMarks: 1,
      });
      return res.json();
    },
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert("Error", err.message || "Failed to save questions"),
  });

  const updateQ = (idx: number, field: keyof ParsedQuestion, value: string) => {
    setParsedQuestions(prev => prev ? prev.map((q, i) => i === idx ? { ...q, [field]: value } : q) : prev);
  };

  const removeQ = (idx: number) => {
    setParsedQuestions(prev => prev ? prev.filter((_, i) => i !== idx) : prev);
  };

  const isParsing = parseTextMutation.isPending || parsePdfMutation.isPending;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
        {/* Header */}
        <View style={{ backgroundColor: "#0A1628", paddingTop: Platform.OS === "web" ? 16 : 44, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={handleClose}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" }}>Bulk Upload Questions</Text>
            {parsedQuestions && <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>{parsedQuestions.length} questions parsed — review & edit</Text>}
          </View>
          {parsedQuestions && !saved && (
            <Pressable
              style={{ backgroundColor: "#22C55E", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}
              onPress={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
              <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" }}>Save All</Text>
            </Pressable>
          )}
        </View>

        {saved ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
            <Ionicons name="checkmark-circle" size={64} color="#22C55E" />
            <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{parsedQuestions?.length} Questions Saved!</Text>
            <Text style={{ fontSize: 14, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" }}>All questions have been added to the test.</Text>
            <Pressable style={{ backgroundColor: Colors.light.primary, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 }} onPress={() => { onSaved(); handleClose(); }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>Done</Text>
            </Pressable>
          </View>
        ) : parsedQuestions ? (
          // Editable preview
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: bottomPadding + 40 }}>
            {parsedQuestions.map((q, idx) => (
              <View key={idx} style={styles.qCard}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <View style={{ backgroundColor: Colors.light.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" }}>Q{idx + 1}</Text>
                  </View>
                  <Pressable onPress={() => removeQ(idx)} style={{ padding: 4 }}>
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  </Pressable>
                </View>
                <Text style={styles.fieldLabel}>Question *</Text>
                <TextInput style={[styles.input, styles.inputMulti]} value={q.questionText} onChangeText={(v) => updateQ(idx, "questionText", v)} multiline placeholder="Question text" placeholderTextColor={Colors.light.textMuted} />
                {(["optionA", "optionB", "optionC", "optionD"] as const).map((opt, oi) => {
                  const letter = ["A", "B", "C", "D"][oi];
                  const isCorrect = q.correctOption === letter;
                  return (
                    <View key={opt} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Pressable
                        onPress={() => updateQ(idx, "correctOption", letter)}
                        style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: isCorrect ? "#22C55E" : Colors.light.border, backgroundColor: isCorrect ? "#22C55E" : "#fff", alignItems: "center", justifyContent: "center" }}
                      >
                        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: isCorrect ? "#fff" : Colors.light.textMuted }}>{letter}</Text>
                      </Pressable>
                      <TextInput
                        style={[styles.input, { flex: 1, marginBottom: 0, borderColor: isCorrect ? "#22C55E" : Colors.light.border, backgroundColor: isCorrect ? "#F0FDF4" : Colors.light.background }]}
                        value={q[opt]}
                        onChangeText={(v) => updateQ(idx, opt, v)}
                        placeholder={`Option ${letter}`}
                        placeholderTextColor={Colors.light.textMuted}
                      />
                    </View>
                  );
                })}
                <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Solution / Explanation (optional)</Text>
                <TextInput style={[styles.input, styles.inputMulti]} value={q.explanation} onChangeText={(v) => updateQ(idx, "explanation", v)} multiline placeholder="Add solution explanation..." placeholderTextColor={Colors.light.textMuted} />
                {/* Question Image */}
                <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Question Image (optional)</Text>
                <ImageUploadBox
                  imageUrl={q.imageUrl}
                  onUrlChange={(v) => updateQ(idx, "imageUrl", v)}
                  placeholder="Paste image URL or upload"
                />
                {/* Solution Image */}
                <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Solution Image (optional)</Text>
                <ImageUploadBox
                  imageUrl={q.solutionImageUrl}
                  onUrlChange={(v) => updateQ(idx, "solutionImageUrl", v)}
                  placeholder="Paste solution image URL or upload"
                />
              </View>
            ))}
            <Pressable
              style={{ backgroundColor: "#22C55E", borderRadius: 12, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
              onPress={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark-circle" size={20} color="#fff" />}
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>Save {parsedQuestions.length} Questions</Text>
            </Pressable>
          </ScrollView>
        ) : (
          // Upload form
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPadding + 40 }}>
            {/* Mode toggle */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["text", "pdf"] as const).map((m) => (
                <Pressable key={m} onPress={() => setMode(m)} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: mode === m ? Colors.light.primary : Colors.light.background, borderWidth: 1, borderColor: mode === m ? Colors.light.primary : Colors.light.border }}>
                  <Ionicons name={m === "text" ? "create" : "document"} size={16} color={mode === m ? "#fff" : Colors.light.text} />
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: mode === m ? "#fff" : Colors.light.text }}>{m === "text" ? "Paste Text" : "Upload PDF"}</Text>
                </Pressable>
              ))}
            </View>

            {mode === "text" ? (
              <>
                <View style={{ backgroundColor: Colors.light.secondary, borderRadius: 10, padding: 12, gap: 4 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Format:</Text>
                  <Text style={{ fontSize: 11, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", lineHeight: 18 }}>
                    {"Q1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B\n\nQ2. Next question..."}
                  </Text>
                </View>
                <TextInput
                  style={[styles.input, { height: 240, textAlignVertical: "top" }]}
                  placeholder="Paste your questions here..."
                  placeholderTextColor={Colors.light.textMuted}
                  value={bulkText}
                  onChangeText={setBulkText}
                  multiline
                />
                <Pressable
                  style={{ backgroundColor: Colors.light.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: !bulkText.trim() ? 0.5 : 1 }}
                  onPress={() => parseTextMutation.mutate()}
                  disabled={!bulkText.trim() || isParsing}
                >
                  {isParsing ? <ActivityIndicator color="#fff" /> : <Ionicons name="scan" size={18} color="#fff" />}
                  <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>Parse & Preview</Text>
                </Pressable>
              </>
            ) : (
              <>
                {uploadError && (
                  <View style={{ backgroundColor: "#FEF2F2", borderRadius: 10, borderWidth: 1, borderColor: "#FCA5A5", padding: 10 }}>
                    <Text style={{ fontSize: 12, color: "#991B1B", fontFamily: "Inter_600SemiBold" }}>
                      {uploadError}
                    </Text>
                  </View>
                )}
                <View style={{ backgroundColor: Colors.light.secondary, borderRadius: 10, padding: 12, gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="document-text" size={16} color={Colors.light.primary} />
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>Supported PDF Formats</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1, backgroundColor: "#EEF2FF", borderRadius: 8, padding: 8, alignItems: "center", gap: 3 }}>
                      <Ionicons name="checkmark-circle" size={18} color="#4F46E5" />
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#4F46E5" }}>PPT → PDF</Text>
                      <Text style={{ fontSize: 10, color: "#6366F1", fontFamily: "Inter_400Regular", textAlign: "center" }}>1 question per slide ✓</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: "#F0FDF4", borderRadius: 8, padding: 8, alignItems: "center", gap: 3 }}>
                      <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#16A34A" }}>Word/Docs PDF</Text>
                      <Text style={{ fontSize: 10, color: "#15803D", fontFamily: "Inter_400Regular", textAlign: "center" }}>Multiple questions ✓</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: "#FEF2F2", borderRadius: 8, padding: 8, alignItems: "center", gap: 3 }}>
                      <Ionicons name="close-circle" size={18} color="#DC2626" />
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#DC2626" }}>Scanned PDF</Text>
                      <Text style={{ fontSize: 10, color: "#EF4444", fontFamily: "Inter_400Regular", textAlign: "center" }}>Image-only ✗</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_600SemiBold" }}>Each question must follow this structure:</Text>
                  <View style={{ backgroundColor: "#fff", borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: Colors.light.primary }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.text, lineHeight: 18 }}>
                      {"Q1. What is the value of sin(90°)?\nA. 0\nB. 1\nC. -1\nD. 0.5\nAnswer: B\n\n— OR PPT style (one per slide) —\n\nWhat is cos(0°)?\nA\n0\nB\n1\nC\n-1\nD\n0.5\nAnswer: B"}
                    </Text>
                  </View>
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Rules:</Text>
                    {[
                      "Question: Q1., Q.1, 1. or 1) — or just the question text on a slide",
                      "Options: A. B. C. D.  or  (A) (B) (C)  or  A on one line, text on next (PPT)",
                      "Answer: Answer: B  or  Ans: B  or  Key: B  or  Correct: B",
                      "PPT PDF: export as PDF from PowerPoint — text must be selectable",
                      "Scanned/photo PDFs won't work — text must be copy-pasteable",
                      "Max file size: 10MB",
                    ].map((rule, i) => (
                      <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.light.primary, marginTop: 6 }} />
                        <Text style={{ flex: 1, fontSize: 11, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", lineHeight: 17 }}>{rule}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {Platform.OS === "web" ? (
                  <Pressable
                    style={styles.filePicker}
                    onPress={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".pdf";
                      input.onchange = (e: any) => {
                        const file = e.target?.files?.[0];
                        if (file) parsePdfMutation.mutate(file);
                      };
                      input.click();
                    }}
                    disabled={isParsing}
                  >
                    {isParsing ? <ActivityIndicator size="large" color={Colors.light.primary} /> : <Ionicons name="cloud-upload" size={36} color={Colors.light.primary} />}
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{isParsing ? "Parsing PDF..." : "Tap to select PDF"}</Text>
                    <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>Max 10MB</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={styles.filePicker}
                    onPress={async () => {
                      try {
                        const DocumentPicker = await import("expo-document-picker");
                        const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });
                        if (!result.canceled && result.assets?.[0]) parsePdfMutation.mutate(result.assets[0]);
                      } catch { Alert.alert("Error", "Could not open file picker"); }
                    }}
                    disabled={isParsing}
                  >
                    {isParsing ? <ActivityIndicator size="large" color={Colors.light.primary} /> : <Ionicons name="cloud-upload" size={36} color={Colors.light.primary} />}
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{isParsing ? "Parsing PDF..." : "Tap to select PDF"}</Text>
                    <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>Max 10MB</Text>
                  </Pressable>
                )}
              </>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function ImageUploadBox({ imageUrl, onUrlChange, placeholder }: { imageUrl: string; onUrlChange: (v: string) => void; placeholder: string }) {
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlText, setUrlText] = useState(imageUrl);
  const [uploading, setUploading] = useState(false);

  const pickImage = async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e: any) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
          const blobUrl = URL.createObjectURL(file);
          const { uploadToR2 } = await import("@/lib/r2-upload");
          const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || "image/jpeg", "images");
          URL.revokeObjectURL(blobUrl);
          onUrlChange(publicUrl);
          setUrlText(publicUrl);
        } catch { Alert.alert("Upload Failed"); }
        setUploading(false);
      };
      input.click();
    } else {
      try {
        const ImagePicker = await import("expo-image-picker");
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
        if (!result.canceled && result.assets?.[0]) {
          setUploading(true);
          try {
            const { uploadToR2 } = await import("@/lib/r2-upload");
            const { publicUrl } = await uploadToR2(result.assets[0].uri, result.assets[0].fileName || `img-${Date.now()}.jpg`, result.assets[0].mimeType || "image/jpeg", "images");
            onUrlChange(publicUrl);
            setUrlText(publicUrl);
          } catch { Alert.alert("Upload Failed"); }
          setUploading(false);
        }
      } catch { Alert.alert("Error", "Could not open image picker"); }
    }
  };

  return (
    <View style={{ marginBottom: 8 }}>
      {!imageUrl ? (
        <View style={{ backgroundColor: "#F8FAFF", borderRadius: 8, borderWidth: 1, borderColor: Colors.light.border, borderStyle: "dashed", padding: 10, marginBottom: 6, alignItems: "center" }}>
          <Ionicons name="image-outline" size={20} color={Colors.light.textMuted} />
          <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 4, textAlign: "center" }}>Recommended: 800×400px · JPG/PNG · max 2MB</Text>
        </View>
      ) : (
        <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: Colors.light.border, marginBottom: 6 }}>
          <Image source={{ uri: imageUrl }} style={{ width: "100%", height: 160 }} resizeMode="contain" />
          <Pressable
            style={{ position: "absolute", top: 6, right: 6, backgroundColor: "#EF4444", borderRadius: 16, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
            onPress={() => { onUrlChange(""); setUrlText(""); }}
          >
            <Ionicons name="close" size={16} color="#fff" />
          </Pressable>
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.light.secondary, borderWidth: 1, borderColor: Colors.light.border, opacity: uploading ? 0.5 : 1 }}
          onPress={pickImage}
          disabled={uploading}
        >
          {uploading ? <ActivityIndicator size="small" color={Colors.light.primary} /> : <Ionicons name="image-outline" size={16} color={Colors.light.primary} />}
          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? "Uploading..." : "Upload Image"}</Text>
        </Pressable>
        <Pressable
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.light.secondary, borderWidth: 1, borderColor: Colors.light.border }}
          onPress={() => setShowUrlInput(v => !v)}
        >
          <Ionicons name="link-outline" size={16} color={Colors.light.primary} />
          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Paste URL</Text>
        </Pressable>
      </View>
      {showUrlInput && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <TextInput
            style={{ flex: 1, backgroundColor: Colors.light.background, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.text, borderWidth: 1, borderColor: Colors.light.border }}
            placeholder={placeholder}
            placeholderTextColor={Colors.light.textMuted}
            value={urlText}
            onChangeText={setUrlText}
            autoCapitalize="none"
          />
          <Pressable
            style={{ backgroundColor: Colors.light.primary, borderRadius: 10, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }}
            onPress={() => { onUrlChange(urlText); setShowUrlInput(false); }}
          >
            <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" }}>Set</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  qCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.light.border, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textSecondary, marginBottom: 4 },
  input: { backgroundColor: Colors.light.background, borderRadius: 10, padding: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, borderWidth: 1, borderColor: Colors.light.border, marginBottom: 8 },
  inputMulti: { height: 80, textAlignVertical: "top" },
  filePicker: { borderWidth: 2, borderColor: Colors.light.border, borderStyle: "dashed", borderRadius: 16, padding: 40, alignItems: "center", gap: 10, backgroundColor: Colors.light.background },
});
