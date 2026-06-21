import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SquareImageCropPicker } from "@/components/SquareImageCropPicker";
import { uploadToR2 } from "@/lib/r2-upload";
import Colors from "@/constants/colors";

type Props = {
  imageUrl: string;
  onChange: (url: string) => void;
  disabled?: boolean;
};

export function AboutTeacherPhotoField({ imageUrl, onChange, disabled }: Props) {
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlText, setUrlText] = useState(imageUrl);

  React.useEffect(() => {
    setUrlText(imageUrl);
  }, [imageUrl]);

  return (
    <View style={styles.wrap}>
      <SquareImageCropPicker
        value={imageUrl}
        onChange={onChange}
        shape="rounded"
        size={100}
        disabled={disabled}
        hint="Square crop before upload"
        changeLabel="Upload teacher photo"
        onUpload={async (uri, opts) => {
          const { publicUrl } = await uploadToR2(
            uri,
            `teacher-${Date.now()}.jpg`,
            "image/jpeg",
            "images",
            {
              signal: opts?.signal,
              onProgress: opts?.onProgress,
            },
          );
          return publicUrl;
        }}
      />
      <Pressable style={styles.urlToggle} onPress={() => setShowUrlInput((v) => !v)}>
        <Ionicons name="link-outline" size={14} color={Colors.light.primary} />
        <Text style={styles.urlToggleText}>Paste URL</Text>
      </Pressable>
      {showUrlInput ? (
        <View style={styles.urlRow}>
          <TextInput
            style={styles.urlInput}
            placeholder="https://..."
            placeholderTextColor={Colors.light.textMuted}
            value={urlText}
            onChangeText={setUrlText}
            autoCapitalize="none"
          />
          <Pressable
            style={styles.urlSetBtn}
            onPress={() => {
              onChange(urlText.trim());
              setShowUrlInput(false);
            }}
          >
            <Text style={styles.urlSetText}>Set</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 6, marginBottom: 8 },
  urlToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
  },
  urlToggleText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.primary,
  },
  urlRow: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
  urlInput: {
    flex: 1,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 9,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  urlSetBtn: {
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  urlSetText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
});

export default AboutTeacherPhotoField;
