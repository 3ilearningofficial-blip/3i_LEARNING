import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Editor } from "tldraw";
import { exportClassroomBoardAllPagesPng } from "@/lib/classroom/exportClassroomBoardViewport";
import { pngSlidesToPdfBlob } from "@/lib/classroom/pngBlobToPdf";
import {
  downloadBoardPdfLocal,
  downloadBoardPngsLocal,
  uploadClassroomBoardArchive,
} from "@/lib/classroom/uploadClassroomBoardArchive";
import Colors from "@/constants/colors";

import type { EndSessionArchive } from "@/lib/classroom/uploadClassroomBoardArchive";

export type { EndSessionArchive };

type Props = {
  visible: boolean;
  liveClassId: string;
  title: string;
  editor: Editor | null;
  boardEl: HTMLElement | null;
  subfolder?: string;
  onClose: () => void;
  onConfirmEnd: (archive: EndSessionArchive | null) => Promise<void>;
};

export default function ClassroomEndSessionModal({
  visible,
  liveClassId,
  title,
  editor,
  boardEl,
  subfolder,
  onClose,
  onConfirmEnd,
}: Props) {
  const [pageCount, setPageCount] = useState(0);
  const [boardReady, setBoardReady] = useState(false);
  const [loadingExport, setLoadingExport] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDownloaded(false);
    setError(null);
    if (!editor) {
      setPageCount(0);
      setBoardReady(false);
      return;
    }
    const pages = editor.getPages();
    setPageCount(pages.length);
    setBoardReady(pages.length > 0);
  }, [visible, editor]);

  const exportPages = useCallback(async () => {
    if (!editor) {
      setError("Whiteboard is still loading. Wait a moment and try again.");
      return null;
    }
    setLoadingExport(true);
    setError(null);
    try {
      const pages = await exportClassroomBoardAllPagesPng(editor, boardEl);
      if (!pages?.length) {
        const n = editor.getPages().length;
        setError(
          n > 0
            ? "Could not render board pages for export. Try switching to each page once, then export again."
            : "No board pages to export"
        );
        return null;
      }
      return pages;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setError(msg);
      return null;
    } finally {
      setLoadingExport(false);
    }
  }, [editor, boardEl]);

  const handleDownloadPdf = async () => {
    const pages = await exportPages();
    if (!pages?.length) return;
    const pdf = await pngSlidesToPdfBlob(pages.map((p) => ({ blob: p.blob, width: p.width, height: p.height })));
    downloadBoardPdfLocal(pdf, title);
    setDownloaded(true);
  };

  const handleDownloadPngs = async () => {
    const pages = await exportPages();
    if (!pages?.length) return;
    downloadBoardPngsLocal(pages, title);
    setDownloaded(true);
  };

  const handleSkipDownload = () => {
    if (!editor) {
      setError("Whiteboard is still loading.");
      return;
    }
    if (Platform.OS === "web") {
      const ok = window.confirm(
        "Skip local download? Your board will still be uploaded to cloud storage when you end class."
      );
      if (ok) setDownloaded(true);
    } else {
      setDownloaded(true);
    }
  };

  const handleEndClass = async () => {
    if (!editor) {
      setError("Whiteboard is still loading. Cannot end class yet.");
      return;
    }
    setEnding(true);
    setError(null);
    try {
      const pages = await exportClassroomBoardAllPagesPng(editor, boardEl);
      let archive: EndSessionArchive | null = null;
      if (pages?.length) {
        const uploaded = await uploadClassroomBoardArchive(liveClassId, pages, subfolder);
        if (uploaded) archive = uploaded;
      }
      await onConfirmEnd(archive);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to end class");
    } finally {
      setEnding(false);
    }
  };

  if (Platform.OS !== "web") return null;

  const canExport = boardReady && !!editor;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>End live class</Text>
          <Text style={styles.subtitle}>
            {canExport
              ? `Download your whiteboard (${pageCount} page${pageCount === 1 ? "" : "s"}) before ending. A cloud backup (PDF + images) is saved to R2 when you end class.`
              : "Whiteboard is still loading. You can end class without a local download; cloud backup runs when the board is ready."}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              style={[styles.btnPrimary, !canExport && styles.btnDisabled]}
              onPress={() => void handleDownloadPdf()}
              disabled={loadingExport || ending || !canExport}
            >
              {loadingExport ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={18} color="#fff" />
                  <Text style={styles.btnPrimaryText}>Download PDF</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={[styles.btnSecondary, !canExport && styles.btnDisabled]}
              onPress={() => void handleDownloadPngs()}
              disabled={loadingExport || ending || !canExport}
            >
              <Ionicons name="images-outline" size={18} color={Colors.light.primary} />
              <Text style={styles.btnSecondaryText}>Download all PNGs</Text>
            </Pressable>
          </View>

          {downloaded ? (
            <View style={styles.okRow}>
              <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
              <Text style={styles.okText}>Download recorded (or skipped)</Text>
            </View>
          ) : (
            <Pressable style={styles.skipLink} onPress={handleSkipDownload} disabled={ending}>
              <Text style={styles.skipText}>Skip download — upload to cloud only</Text>
            </Pressable>
          )}

          <View style={styles.footer}>
            <Pressable style={styles.cancelBtn} onPress={onClose} disabled={ending}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.endBtn, (!downloaded || ending) && styles.endBtnDisabled]}
              onPress={() => void handleEndClass()}
              disabled={!downloaded || ending}
            >
              {ending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.endBtnText}>Save to cloud & End class</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: "800", color: Colors.light.text },
  subtitle: { fontSize: 13, color: Colors.light.textMuted, lineHeight: 18 },
  error: { fontSize: 12, color: Colors.light.error },
  actions: { gap: 8 },
  btnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.light.primary,
    paddingVertical: 12,
    borderRadius: 8,
  },
  btnDisabled: { opacity: 0.45 },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnSecondaryText: { color: Colors.light.primary, fontWeight: "600", fontSize: 13 },
  okRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  okText: { fontSize: 12, color: "#16A34A", fontWeight: "600" },
  skipLink: { paddingVertical: 4 },
  skipText: { fontSize: 12, color: Colors.light.textMuted, textDecorationLine: "underline" },
  footer: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  cancelText: { fontWeight: "600", color: Colors.light.text },
  endBtn: {
    flex: 2,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#7F1D1D",
  },
  endBtnDisabled: { opacity: 0.5 },
  endBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
