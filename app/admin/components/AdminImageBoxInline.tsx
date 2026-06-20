import React, { useRef } from "react";
import {
  View, Text, Alert, Image, Pressable, ActivityIndicator,
  TextInput, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { uploadToR2 } from "@/lib/r2-upload";
import Colors from "@/constants/colors";

export function AdminImageBoxInline({ imageUrl, onUrlChange }: { imageUrl: string; onUrlChange: (v: string) => void }) {
  const [showInput, setShowInput] = React.useState(false);
  const [urlText, setUrlText] = React.useState(imageUrl);
  const [uploading, setUploading] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState(0);
  const abortRef = useRef<AbortController | null>(null);

  React.useEffect(() => {
    setUrlText(imageUrl);
  }, [imageUrl]);

  const cancelUpload = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUploading(false);
    setUploadPct(0);
  };

  const runUpload = async (fileUri: string, fileName: string, mimeType: string, contentLength?: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setUploadPct(0);
    try {
      const { publicUrl } = await uploadToR2(fileUri, fileName, mimeType, "images", {
        onProgress: (pct) => setUploadPct(pct),
        signal: controller.signal,
        contentLength,
      });
      onUrlChange(publicUrl);
      setUrlText(publicUrl);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        Alert.alert("Upload Failed", err?.message || "Could not upload image.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setUploading(false);
      setUploadPct(0);
    }
  };

  const pickImage = () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e: any) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        const blobUrl = URL.createObjectURL(file);
        try {
          await runUpload(blobUrl, file.name, file.type || "image/jpeg", file.size);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      };
      input.click();
    } else {
      import("expo-image-picker").then(async (IP) => {
        const r = await IP.launchImageLibraryAsync({ mediaTypes: IP.MediaTypeOptions.Images, quality: 0.8 });
        if (!r.canceled && r.assets?.[0]) {
          const asset = r.assets[0];
          await runUpload(
            asset.uri,
            asset.fileName || `img-${Date.now()}.jpg`,
            asset.mimeType || "image/jpeg",
            asset.fileSize,
          );
        }
      }).catch(() => Alert.alert("Error", "Could not open image picker"));
    }
  };

  return (
    <View>
      {imageUrl ? (
        <View style={{ borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 6, position: "relative" }}>
          <Image source={{ uri: imageUrl }} style={{ width: "100%", height: 130 }} resizeMode="contain" />
          <Pressable
            style={{ position: "absolute", top: 4, right: 4, backgroundColor: "#EF4444", borderRadius: 12, width: 24, height: 24, alignItems: "center", justifyContent: "center" }}
            onPress={() => { onUrlChange(""); setUrlText(""); }}
          >
            <Ionicons name="close" size={13} color="#fff" />
          </Pressable>
        </View>
      ) : null}
      {uploading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, padding: 10, borderRadius: 8, backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE" }}>
          <ActivityIndicator size="small" color={Colors.light.primary} />
          <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Uploading {uploadPct}%</Text>
          <Pressable onPress={cancelUpload} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color="#EF4444" />
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 8, backgroundColor: Colors.light.secondary, borderWidth: 1, borderColor: "#E5E7EB", opacity: uploading ? 0.5 : 1 }} disabled={uploading} onPress={pickImage}>
          <Ionicons name="cloud-upload-outline" size={15} color={Colors.light.primary} />
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Upload Image</Text>
        </Pressable>
        <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 8, backgroundColor: Colors.light.secondary, borderWidth: 1, borderColor: "#E5E7EB" }} onPress={() => setShowInput(v => !v)}>
          <Ionicons name="link-outline" size={15} color={Colors.light.primary} />
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Paste URL</Text>
        </Pressable>
      </View>
      {showInput && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <TextInput style={{ flex: 1, backgroundColor: Colors.light.background, borderRadius: 8, padding: 9, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.text, borderWidth: 1, borderColor: "#E5E7EB" }} placeholder="https://..." placeholderTextColor={Colors.light.textMuted} value={urlText} onChangeText={setUrlText} autoCapitalize="none" />
          <Pressable style={{ backgroundColor: Colors.light.primary, borderRadius: 8, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }} onPress={() => { onUrlChange(urlText); setShowInput(false); }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" }}>Set</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default AdminImageBoxInline;
