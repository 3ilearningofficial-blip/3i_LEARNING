import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
  Switch,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import {
  BULK_LIMITS_FOOTER,
  MAX_FILES_PER_BATCH,
  UPLOAD_CONCURRENCY,
} from "@/lib/bulk-upload-limits";
import {
  type BulkContentKind,
  collectFilesFromDataTransfer,
  computeBaseOrderIndex,
  inferMaterialFileType,
  probeVideoDurationWeb,
  resolveDefaultSection,
  titleFromFilename,
  validateBatch,
  validateFileForKind,
} from "@/lib/bulk-upload-utils";
import {
  deleteR2Orphan,
  getMimeType,
  uploadManyToR2,
  type BulkUploadJob,
  type BulkUploadJobFile,
} from "@/lib/r2-upload";
import { apiRequest } from "@/lib/query-client";
import SortableList from "@/components/admin/SortableList";
import SortableItem from "@/components/admin/SortableItem";

type RowStatus =
  | "queued"
  | "uploading"
  | "uploaded"
  | "error"
  | "too_large"
  | "wrong_type"
  | "cancelled";

export interface BulkUploadPanelProps {
  kind: BulkContentKind;
  courseId: number;
  parentFolderName?: string | null;
  subjectKey?: string | null;
  baseOrderIndex: number;
  existingItems: {
    section_title?: string | null;
    order_index?: number | null;
    subject_key?: string | null;
  }[];
  onSaved: () => void;
  onEnsureLectureFolder?: (path: string) => Promise<void>;
  courseQueryKey?: string;
}

interface BulkRow {
  id: string;
  file: BulkUploadJobFile | null;
  filename: string;
  title: string;
  sectionTitle: string;
  durationMinutes: string;
  isFreePreview: boolean;
  downloadAllowed: boolean;
  orderIndex: number;
  status: RowStatus;
  progress: number;
  error?: string;
  publicUrl?: string;
  r2Key?: string;
  fileType?: string;
}

let rowCounter = 0;
function nextRowId() {
  rowCounter += 1;
  return `bulk-${Date.now()}-${rowCounter}`;
}

function reorderRows(rows: BulkRow[], activeId: string | number, overId: string | number): BulkRow[] {
  const from = rows.findIndex((r) => r.id === activeId);
  const to = rows.findIndex((r) => r.id === overId);
  if (from < 0 || to < 0 || from === to) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((r, i) => ({ ...r, orderIndex: r.orderIndex >= 0 ? r.orderIndex : i }));
}

function reindexOrders(rows: BulkRow[], start: number): BulkRow[] {
  let order = start;
  return rows.map((r) => {
    if (r.status === "uploaded" || r.status === "queued" || r.status === "uploading") {
      const updated = { ...r, orderIndex: order };
      order += 1;
      return updated;
    }
    return r;
  });
}

export default function BulkUploadPanel({
  kind,
  courseId,
  parentFolderName,
  subjectKey,
  baseOrderIndex,
  existingItems,
  onSaved,
  onEnsureLectureFolder,
  courseQueryKey,
}: BulkUploadPanelProps) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [batchFreePreview, setBatchFreePreview] = useState(false);
  const [batchDownload, setBatchDownload] = useState(false);
  const [batchSection, setBatchSection] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const abortMap = useRef<Map<string, AbortController>>(new Map());
  const orderStartRef = useRef(baseOrderIndex);

  useEffect(() => {
    orderStartRef.current = computeBaseOrderIndex(existingItems, {
      sectionTitle: parentFolderName || batchSection || null,
      subjectKey: subjectKey || null,
    });
  }, [existingItems, parentFolderName, batchSection, subjectKey]);

  const acceptAttr =
    kind === "lecture" ? "video/*,.mp4,.mov,.mkv,.webm" : ".pdf,.doc,.docx,video/*,.mp4,.mov";

  const runUploadJobs = useCallback(
    (jobs: BulkUploadJob[]) => {
      if (jobs.length === 0) return;
      setUploading(true);

      for (const job of jobs) {
        if (!abortMap.current.has(job.id)) {
          abortMap.current.set(job.id, new AbortController());
        }
        setRows((prev) =>
          prev.map((r) => (r.id === job.id ? { ...r, status: "uploading", progress: 0 } : r)),
        );
      }

      void uploadManyToR2(
        jobs,
        {
          onProgress: (id, pct) => {
            setRows((prev) => prev.map((r) => (r.id === id ? { ...r, progress: pct } : r)));
          },
          onDone: (id, result) => {
            setRows((prev) =>
              prev.map((r) =>
                r.id === id
                  ? {
                      ...r,
                      status: "uploaded",
                      progress: 100,
                      publicUrl: result.publicUrl,
                      r2Key: result.key,
                    }
                  : r,
              ),
            );
            abortMap.current.delete(id);
          },
          onError: (id, err) => {
            const aborted = err.name === "AbortError";
            setRows((prev) =>
              prev.map((r) =>
                r.id === id
                  ? {
                      ...r,
                      status: aborted ? "cancelled" : "error",
                      error: aborted ? "Cancelled" : err.message,
                    }
                  : r,
              ),
            );
            abortMap.current.delete(id);
          },
        },
        {
          concurrency: UPLOAD_CONCURRENCY,
          getSignal: (id) => abortMap.current.get(id)?.signal,
        },
      ).finally(() => {
        setUploading(false);
      });
    },
    [kind],
  );

  const addFiles = useCallback(
    async (rawFiles: File[]) => {
      if (rawFiles.length === 0) return;
      const batchCheck = validateBatch(
        rawFiles.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
          webkitRelativePath: (f as any).webkitRelativePath,
        })),
        kind,
      );
      if (!batchCheck.ok && batchCheck.error) {
        Alert.alert("Batch limit", batchCheck.error);
        if (batchCheck.files.length === 0) return;
      }

      const remaining = MAX_FILES_PER_BATCH - rows.length;
      const toAdd = rawFiles.slice(0, remaining);
      if (toAdd.length === 0) {
        Alert.alert("Limit reached", "Maximum 50 files per batch.");
        return;
      }

      const newRows: BulkRow[] = [];
      const uploadJobs: BulkUploadJob[] = [];

      for (const file of toAdd) {
        const meta = {
          name: file.name,
          size: file.size,
          type: file.type,
          webkitRelativePath: (file as any).webkitRelativePath,
        };
        const relativePath = meta.webkitRelativePath || "";
        const validation = validateFileForKind(kind, meta);
        const sectionDefault =
          batchSection.trim() || resolveDefaultSection({ parentFolderName, relativePath });

        const priorInBatch = newRows.filter((r) => r.sectionTitle === sectionDefault);
        const orderIndex = computeBaseOrderIndex(
          [
            ...existingItems,
            ...priorInBatch.map((r) => ({
              section_title: r.sectionTitle,
              order_index: r.orderIndex,
              subject_key: subjectKey,
            })),
          ],
          { sectionTitle: sectionDefault, subjectKey: subjectKey || null },
        );

        const row: BulkRow = {
          id: nextRowId(),
          file: file as BulkUploadJobFile,
          filename: meta.name,
          title: titleFromFilename(meta.name),
          sectionTitle: sectionDefault,
          durationMinutes: "",
          isFreePreview: batchFreePreview,
          downloadAllowed: batchDownload,
          orderIndex: validation.ok ? orderIndex : 0,
          status: validation.ok ? "queued" : validation.reason === "too_large" ? "too_large" : "wrong_type",
          progress: 0,
          error: validation.ok ? undefined : validation.message,
          fileType: kind === "material" ? inferMaterialFileType(meta.name, meta.type) : undefined,
        };

        if (validation.ok) {
          uploadJobs.push({
            id: row.id,
            file: file,
            folder: kind === "lecture" ? "lectures" : "materials",
          });
        }
        newRows.push(row);

        if (validation.ok && kind === "lecture" && Platform.OS === "web") {
          void probeVideoDurationWeb(file).then((mins) => {
            if (mins > 0) {
              setRows((prev) =>
                prev.map((r) => (r.id === row.id ? { ...r, durationMinutes: String(mins) } : r)),
              );
            }
          });
        }
      }

      setRows((prev) => [...prev, ...newRows]);
      runUploadJobs(uploadJobs);
    },
    [batchDownload, batchFreePreview, batchSection, existingItems, kind, parentFolderName, rows.length, runUploadJobs, subjectKey],
  );

  const pickFilesWeb = (opts: { directory?: boolean }) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = acceptAttr;
    if (opts.directory) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
    input.onchange = () => {
      const list = Array.from(input.files || []);
      void addFiles(list);
    };
    input.click();
  };

  const pickFilesNative = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        type: kind === "lecture" ? "video/*" : ["application/pdf", "video/*", "*/*"],
      });
      if (result.canceled || !result.assets?.length) return;
      const pseudoFiles = result.assets.map((a) => ({
        uri: a.uri,
        name: a.name || `file-${Date.now()}`,
        mimeType: a.mimeType || getMimeType(a.name || ""),
        size: a.size || 0,
      }));
      const newRows: BulkRow[] = [];
      for (const asset of pseudoFiles) {
        const meta = { name: asset.name, size: asset.size, type: asset.mimeType };
        const validation = validateFileForKind(kind, meta);
        const sectionDefault = batchSection.trim() || resolveDefaultSection({ parentFolderName });
        const priorInBatch = newRows.filter((r) => r.sectionTitle === sectionDefault);
        const orderIndex = computeBaseOrderIndex(
          [
            ...existingItems,
            ...priorInBatch.map((r) => ({
              section_title: r.sectionTitle,
              order_index: r.orderIndex,
              subject_key: subjectKey,
            })),
          ],
          { sectionTitle: sectionDefault, subjectKey: subjectKey || null },
        );
        const row: BulkRow = {
          id: nextRowId(),
          file: asset,
          filename: asset.name,
          title: titleFromFilename(asset.name),
          sectionTitle: sectionDefault,
          durationMinutes: "",
          isFreePreview: batchFreePreview,
          downloadAllowed: batchDownload,
          orderIndex: validation.ok ? orderIndex : 0,
          status: validation.ok ? "queued" : validation.reason === "too_large" ? "too_large" : "wrong_type",
          progress: 0,
          error: validation.ok ? undefined : validation.message,
          fileType: kind === "material" ? inferMaterialFileType(asset.name, asset.mimeType) : undefined,
        };
        newRows.push(row);
      }
      const uploadJobs: BulkUploadJob[] = newRows
        .filter((r) => r.status === "queued" && r.file)
        .map((r) => ({
          id: r.id,
          file: r.file!,
          folder: kind === "lecture" ? "lectures" : "materials",
        }));
      setRows((prev) => [...prev, ...newRows]);
      runUploadJobs(uploadJobs);
    } catch (err: any) {
      Alert.alert("Pick failed", err?.message || "Could not pick files");
    }
  };

  const cancelRow = async (row: BulkRow) => {
    const ctrl = abortMap.current.get(row.id);
    if (ctrl) ctrl.abort();
    if (row.r2Key && row.status === "uploaded") {
      await deleteR2Orphan(row.r2Key);
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  const cancelAll = () => {
    for (const ctrl of abortMap.current.values()) ctrl.abort();
    void (async () => {
      for (const row of rows) {
        if (row.r2Key && row.status === "uploaded") await deleteR2Orphan(row.r2Key);
      }
      setRows([]);
    })();
  };

  const uploadedRows = rows.filter((r) => r.status === "uploaded");
  const canSave =
    uploadedRows.length > 0 &&
    uploadedRows.every((r) => r.title.trim() !== "") &&
    (kind === "material" || uploadedRows.every((r) => (parseInt(r.durationMinutes, 10) || 0) > 0));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const toSave = rows
        .filter((r) => r.status === "uploaded" && r.publicUrl)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      if (kind === "lecture" && onEnsureLectureFolder) {
        const paths = [...new Set(toSave.map((r) => r.sectionTitle.trim()).filter((p) => p.includes(" / ")))];
        for (const p of paths) await onEnsureLectureFolder(p);
      }

      if (kind === "lecture") {
        await apiRequest("POST", "/api/admin/lectures/bulk", {
          courseId,
          subjectKey: subjectKey || null,
          items: toSave.map((r) => ({
            title: r.title.trim(),
            videoUrl: r.publicUrl,
            videoType: "r2",
            durationMinutes: parseInt(r.durationMinutes, 10) || 0,
            orderIndex: r.orderIndex,
            sectionTitle: r.sectionTitle.trim() || null,
            isFreePreview: r.isFreePreview,
            downloadAllowed: r.downloadAllowed,
          })),
        });
      } else {
        await apiRequest("POST", "/api/admin/study-materials/bulk", {
          courseId,
          subjectKey: subjectKey || null,
          items: toSave.map((r) => ({
            title: r.title.trim(),
            fileUrl: r.publicUrl,
            fileType: r.fileType || inferMaterialFileType(r.filename),
            orderIndex: r.orderIndex,
            sectionTitle: r.sectionTitle.trim() || null,
            downloadAllowed: r.downloadAllowed,
          })),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [courseQueryKey || "/api/courses", String(courseId)] });
      Alert.alert("Success", `${uploadedRows.length} ${kind === "lecture" ? "lectures" : "materials"} added!`);
      onSaved();
    },
    onError: (err: any) => {
      Alert.alert("Save failed", err?.message?.replace(/^\S+\s->\s\d+:\s*/, "") || "Could not save batch");
    },
  });

  const applyBatchSection = () => {
    const v = batchSection.trim();
    if (!v) return;
    setRows((prev) => prev.map((r) => ({ ...r, sectionTitle: v })));
  };

  const handleReorder = (activeId: string | number, overId: string | number) => {
    setRows((prev) => {
      const reordered = reorderRows(prev, activeId, overId);
      return reindexOrders(reordered, baseOrderIndex);
    });
  };

  const totalBytes = useMemo(
    () => rows.reduce((s, r) => s + (r.file && "size" in r.file ? r.file.size : 0), 0),
    [rows],
  );

  const renderRow = (row: BulkRow, idx: number) => {
    const statusColor =
      row.status === "uploaded"
        ? "#16A34A"
        : row.status === "error" || row.status === "too_large" || row.status === "wrong_type"
          ? Colors.light.error
          : row.status === "cancelled"
            ? Colors.light.textMuted
            : Colors.light.primary;

    const inner = (
      <View
        style={[
          styles.rowCard,
          (row.status === "too_large" || row.status === "wrong_type") && styles.rowCardError,
        ]}
      >
        <View style={styles.rowTop}>
          <Text style={styles.rowNum}>{idx + 1}</Text>
          <Text style={styles.filename} numberOfLines={1}>
            {row.filename}
          </Text>
          <Pressable onPress={() => void cancelRow(row)} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={Colors.light.textMuted} />
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          value={row.title}
          onChangeText={(v) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, title: v } : r)))}
          placeholder="Title"
          placeholderTextColor={Colors.light.textMuted}
        />
        <TextInput
          style={styles.input}
          value={row.sectionTitle}
          onChangeText={(v) =>
            setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, sectionTitle: v } : r)))
          }
          placeholder="Section / folder"
          placeholderTextColor={Colors.light.textMuted}
        />
        {kind === "lecture" && (
          <TextInput
            style={styles.input}
            value={row.durationMinutes}
            onChangeText={(v) =>
              setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, durationMinutes: v } : r)))
            }
            placeholder="Duration (minutes)"
            placeholderTextColor={Colors.light.textMuted}
            keyboardType="numeric"
          />
        )}
        <View style={styles.rowToggles}>
          {kind === "lecture" && (
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Free</Text>
              <Switch
                value={row.isFreePreview}
                onValueChange={(v) =>
                  setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isFreePreview: v } : r)))
                }
              />
            </View>
          )}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Download</Text>
            <Switch
              value={row.downloadAllowed}
              onValueChange={(v) =>
                setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, downloadAllowed: v } : r)))
              }
            />
          </View>
        </View>
        <View style={styles.statusRow}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {row.status === "uploading"
              ? `Uploading ${row.progress}%`
              : row.status === "uploaded"
                ? "Uploaded ✓"
                : row.status === "queued"
                  ? "Queued"
                  : row.error || row.status}
          </Text>
          {row.status === "uploading" && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${row.progress}%` as any }]} />
            </View>
          )}
        </View>
      </View>
    );

    if (Platform.OS === "web") {
      return (
        <SortableItem key={row.id} id={row.id}>
          {inner}
        </SortableItem>
      );
    }

    return (
      <View key={row.id}>
        <View style={styles.nativeReorder}>
          <Pressable
            disabled={idx === 0}
            onPress={() => {
              if (idx === 0) return;
              setRows((prev) => {
                const next = [...prev];
                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                return reindexOrders(next, baseOrderIndex);
              });
            }}
          >
            <Ionicons name="chevron-up" size={18} color={idx === 0 ? "#D1D5DB" : Colors.light.text} />
          </Pressable>
          <Pressable
            disabled={idx === rows.length - 1}
            onPress={() => {
              if (idx === rows.length - 1) return;
              setRows((prev) => {
                const next = [...prev];
                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                return reindexOrders(next, baseOrderIndex);
              });
            }}
          >
            <Ionicons
              name="chevron-down"
              size={18}
              color={idx === rows.length - 1 ? "#D1D5DB" : Colors.light.text}
            />
          </Pressable>
        </View>
        {inner}
      </View>
    );
  };

  const rowList =
    Platform.OS === "web" ? (
      <SortableList ids={rows.map((r) => r.id)} onReorder={handleReorder}>
        {rows.map((row, idx) => renderRow(row, idx))}
      </SortableList>
    ) : (
      rows.map((row, idx) => renderRow(row, idx))
    );

  return (
    <View style={styles.container}>
      <View
        style={[styles.dropZone, dragOver && styles.dropZoneActive]}
        {...(Platform.OS === "web"
          ? {
              onDragOver: (e: any) => {
                e.preventDefault();
                setDragOver(true);
              },
              onDragLeave: () => setDragOver(false),
              onDrop: (e: any) => {
                e.preventDefault();
                setDragOver(false);
                void collectFilesFromDataTransfer(e.dataTransfer).then((files) => addFiles(files));
              },
            }
          : {})}
      >
        <Ionicons name="cloud-upload-outline" size={28} color={Colors.light.primary} />
        <Text style={styles.dropTitle}>
          {Platform.OS === "web" ? "Drag & drop files or a folder here" : "Choose multiple files"}
        </Text>
        <Text style={styles.dropLimits}>{BULK_LIMITS_FOOTER}</Text>
        <View style={styles.pickRow}>
          <Pressable
            style={styles.pickBtn}
            onPress={() => (Platform.OS === "web" ? pickFilesWeb({ directory: false }) : void pickFilesNative())}
          >
            <Text style={styles.pickBtnText}>Choose Files</Text>
          </Pressable>
          {Platform.OS === "web" && (
            <Pressable style={styles.pickBtn} onPress={() => pickFilesWeb({ directory: true })}>
              <Text style={styles.pickBtnText}>Choose Folder</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.defaults}>
        {kind === "lecture" && (
          <View style={styles.defaultRow}>
            <Text style={styles.defaultLabel}>Free preview (all)</Text>
            <Switch value={batchFreePreview} onValueChange={setBatchFreePreview} />
          </View>
        )}
        <View style={styles.defaultRow}>
          <Text style={styles.defaultLabel}>Allow download (all)</Text>
          <Switch value={batchDownload} onValueChange={setBatchDownload} />
        </View>
        {!parentFolderName && (
          <View style={styles.sectionApply}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={batchSection}
              onChangeText={setBatchSection}
              placeholder="Default section for all rows"
              placeholderTextColor={Colors.light.textMuted}
            />
            <Pressable style={styles.applyBtn} onPress={applyBatchSection}>
              <Text style={styles.applyBtnText}>Apply</Text>
            </Pressable>
          </View>
        )}
        {rows.length > 0 && (
          <Pressable style={styles.cancelAllBtn} onPress={cancelAll}>
            <Text style={styles.cancelAllText}>Cancel All</Text>
          </Pressable>
        )}
      </View>

      {rows.length > 0 && (
        <Text style={styles.summary}>
          {rows.length} file(s) · {Math.round(totalBytes / (1024 * 1024))} MB total · {uploadedRows.length} ready
        </Text>
      )}

      <ScrollView style={styles.table} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {rowList}
      </ScrollView>

      <Pressable
        style={[styles.saveBtn, (!canSave || saveMutation.isPending) && styles.saveBtnDisabled]}
        disabled={!canSave || saveMutation.isPending}
        onPress={() => saveMutation.mutate()}
      >
        {saveMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveBtnText}>
            Save {uploadedRows.length} {kind === "lecture" ? "Lecture" : "Material"}
            {uploadedRows.length !== 1 ? "s" : ""}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  dropZone: {
    borderWidth: 1.5,
    borderColor: Colors.light.primary,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EEF2FF",
  },
  dropZoneActive: { backgroundColor: "#DBEAFE", borderColor: "#2563EB" },
  dropTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, textAlign: "center" },
  dropLimits: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "center" },
  pickRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  pickBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.primary,
  },
  pickBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  defaults: { gap: 8 },
  defaultRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  defaultLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text },
  sectionApply: { flexDirection: "row", gap: 8, alignItems: "center" },
  applyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.light.secondary,
  },
  applyBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  cancelAllBtn: { alignSelf: "flex-start" },
  cancelAllText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.error },
  summary: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted },
  table: { maxHeight: 320 },
  rowCard: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  rowCardError: { borderColor: Colors.light.error, backgroundColor: "#FEF2F2" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  rowNum: { fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.textMuted, width: 20 },
  filename: { flex: 1, fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    marginBottom: 6,
    backgroundColor: "#FAFBFF",
  },
  rowToggles: { flexDirection: "row", gap: 16, marginBottom: 4 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggleLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.text },
  statusRow: { gap: 4 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  progressBar: { height: 4, backgroundColor: "#E5E7EB", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: Colors.light.primary, borderRadius: 2 },
  nativeReorder: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginBottom: 2 },
  saveBtn: {
    backgroundColor: Colors.light.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
});
