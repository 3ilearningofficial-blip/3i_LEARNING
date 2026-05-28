import React from "react";
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
  const pickImage = () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*";
      input.onchange = async (e: any) => {
        const file = e.target?.files?.[0]; if (!file) return;
        setUploading(true); setUploadPct(0);
        try {
          const blobUrl = URL.createObjectURL(file);
          const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || "image/jpeg", "images", (pct) => setUploadPct(pct));
          URL.revokeObjectURL(blobUrl);
          onUrlChange(publicUrl); setUrlText(publicUrl);
          setUploading(false); setUploadPct(0);
        } catch { setUploading(false); setUploadPct(0); Alert.alert("Upload Failed"); }
      };
      input.click();
    } else {
      import("expo-image-picker").then(async (IP) => {
        const r = await IP.launchImageLibraryAsync({ mediaTypes: IP.MediaTypeOptions.Images, quality: 0.8 });
        if (!r.canceled && r.assets?.[0]) {
          setUploading(true); setUploadPct(0);
          try {
            const { publicUrl } = await uploadToR2(r.assets[0].uri, r.assets[0].fileName || `img-${Date.now()}.jpg`, r.assets[0].mimeType || "image/jpeg", "images", (pct) => setUploadPct(pct));
            onUrlChange(publicUrl); setUrlText(publicUrl);
          } catch { Alert.alert("Upload Failed"); }
          setUploading(false); setUploadPct(0);
        }
      }).catch(() => Alert.alert("Error", "Could not open image picker"));
    }
  };
  return (
    <View>
      {imageUrl ? (
        <View style={{ borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 6 }}>
          <Image source={{ uri: imageUrl }} style={{ width: "100%", height: 130 }} resizeMode="contain" />
          <Pressable style={{ position: "absolute", top: 4, right: 4, backgroundColor: "#EF4444", borderRadius: 12, width: 24, height: 24, alignItems: "center", justifyContent: "center" }} onPress={() => { onUrlChange(""); setUrlText(""); }}>
            <Ionicons name="close" size={13} color="#fff" />
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 8, backgroundColor: Colors.light.secondary, borderWidth: 1, borderColor: "#E5E7EB", opacity: uploading ? 0.5 : 1 }} disabled={uploading} onPress={pickImage}>
          {uploading ? <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadPct}%</Text> : <Ionicons name="cloud-upload-outline" size={15} color={Colors.light.primary} />}
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading ${uploadPct}%` : "Upload Image"}</Text>
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
