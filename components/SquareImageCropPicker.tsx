import React, { useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import SquareImageCropModal from "./SquareImageCropModal";
import Colors from "@/constants/colors";

export type SquareImageCropPickerUpload = (
  uri: string,
  opts?: { signal?: AbortSignal; onProgress?: (pct: number) => void },
) => Promise<string>;

type Props = {
  value: string;
  onChange: (url: string) => void;
  onUpload?: SquareImageCropPickerUpload;
  size?: number;
  shape?: "circle" | "rounded";
  disabled?: boolean;
  hint?: string;
  placeholderInitial?: string;
  changeLabel?: string;
};

export function SquareImageCropPicker({
  value,
  onChange,
  onUpload,
  size = 100,
  shape = "circle",
  disabled = false,
  hint,
  placeholderInitial,
  changeLabel = "Change photo",
}: Props) {
  const borderRadius = shape === "circle" ? size / 2 : 20;
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [cropModal, setCropModal] = useState<{
    src: string;
    fileName: string;
    mimeType: string;
    fileSize?: number;
  } | null>(null);

  const cancelUpload = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUploading(false);
    setUploadPct(0);
  };

  const finishWithUri = async (uri: string, fileName: string, mimeType: string, fileSize?: number) => {
    if (onUpload) {
      const controller = new AbortController();
      abortRef.current = controller;
      setUploading(true);
      setUploadPct(0);
      try {
        const publicUrl = await onUpload(uri, {
          signal: controller.signal,
          onProgress: (pct) => setUploadPct(pct),
        });
        onChange(publicUrl);
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          Alert.alert("Upload Failed", err?.message || "Could not upload image.");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setUploading(false);
        setUploadPct(0);
        if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
      }
      return;
    }
    onChange(uri);
  };

  const pickNative = async () => {
    const IP = await import("expo-image-picker");
    const { status } = await IP.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo library access.");
      return;
    }
    const result = await IP.launchImageLibraryAsync({
      mediaTypes: IP.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    await finishWithUri(
      asset.uri,
      asset.fileName || `photo-${Date.now()}.jpg`,
      asset.mimeType || "image/jpeg",
      asset.fileSize,
    );
  };

  const pickWeb = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const MAX_BYTES = 12 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        Alert.alert("Image too large", "Please choose an image smaller than 12 MB.");
        return;
      }
      const blobUrl = URL.createObjectURL(file);
      setCropModal({
        src: blobUrl,
        fileName: file.name,
        mimeType: file.type || "image/jpeg",
        fileSize: file.size,
      });
    };
    input.click();
  };

  const handlePick = () => {
    if (disabled || uploading) return;
    if (Platform.OS === "web") pickWeb();
    else void pickNative();
  };

  const handleCropSave = async (croppedUri: string) => {
    const meta = cropModal;
    setCropModal(null);
    if (meta?.src.startsWith("blob:")) URL.revokeObjectURL(meta.src);
    await finishWithUri(
      croppedUri,
      meta?.fileName || `photo-${Date.now()}.jpg`,
      meta?.mimeType || "image/jpeg",
      meta?.fileSize,
    );
  };

  const handleCropCancel = () => {
    if (cropModal?.src.startsWith("blob:")) URL.revokeObjectURL(cropModal.src);
    setCropModal(null);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        style={[styles.previewWrap, { width: size, height: size, borderRadius }]}
        onPress={handlePick}
        disabled={disabled || uploading}
      >
        {value ? (
          <Image source={{ uri: value }} style={{ width: size, height: size, borderRadius }} resizeMode="cover" />
        ) : (
          <View style={[styles.placeholder, { width: size, height: size, borderRadius }]}>
            {placeholderInitial ? (
              <Text style={[styles.initial, { fontSize: Math.round(size * 0.36) }]}>{placeholderInitial}</Text>
            ) : (
              <Ionicons name="camera" size={Math.round(size * 0.32)} color={Colors.light.primary} />
            )}
          </View>
        )}
        {!disabled && !uploading ? (
          <View style={styles.camBadge}>
            <Ionicons name="camera" size={13} color="#fff" />
          </View>
        ) : null}
        {value && !disabled && !uploading ? (
          <Pressable
            style={styles.removeBtn}
            hitSlop={8}
            onPress={(e) => {
              e?.stopPropagation?.();
              onChange("");
            }}
          >
            <Ionicons name="close" size={13} color="#fff" />
          </Pressable>
        ) : null}
      </Pressable>

      {uploading ? (
        <View style={styles.uploadRow}>
          <ActivityIndicator size="small" color={Colors.light.primary} />
          <Text style={styles.uploadText}>Uploading {uploadPct}%</Text>
          <Pressable onPress={cancelUpload} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color="#EF4444" />
          </Pressable>
        </View>
      ) : null}

      {!uploading ? (
        <Pressable onPress={handlePick} disabled={disabled}>
          <Text style={[styles.changeText, disabled && { opacity: 0.5 }]}>{changeLabel}</Text>
        </Pressable>
      ) : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {Platform.OS === "web" && cropModal ? (
        <SquareImageCropModal
          visible
          imageSrc={cropModal.src}
          onCancel={handleCropCancel}
          onSave={handleCropSave}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 8 },
  previewWrap: { position: "relative", overflow: "hidden" },
  placeholder: {
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.light.primary,
    borderStyle: "dashed",
  },
  initial: { fontFamily: "Inter_700Bold", color: Colors.light.primary },
  camBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.light.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  removeBtn: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
    alignSelf: "stretch",
  },
  uploadText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.primary,
  },
  changeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.primary,
  },
  hint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textMuted,
    textAlign: "center",
  },
});

export default SquareImageCropPicker;
