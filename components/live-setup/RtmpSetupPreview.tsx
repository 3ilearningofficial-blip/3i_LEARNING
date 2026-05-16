import React from "react";
import { View, Text, StyleSheet, TextInput, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getYouTubeVideoId } from "@/lib/youtube-utils";
import Colors from "@/constants/colors";

type Props = {
  youtubeUrl: string;
  onYoutubeUrlChange: (v: string) => void;
};

function buildYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&mute=1&playsinline=1&rel=0&modestbranding=1`;
}

export default function RtmpSetupPreview({ youtubeUrl, onYoutubeUrlChange }: Props) {
  const videoId = getYouTubeVideoId(youtubeUrl);

  return (
    <View style={styles.wrap}>
      {videoId && Platform.OS === "web" ? (
        <iframe
          src={buildYouTubeEmbedUrl(videoId)}
          style={{ width: "100%", height: "100%", border: "none" } as any}
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
        />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons name="logo-youtube" size={64} color="#FF0000" />
          <Text style={styles.placeholderText}>
            {youtubeUrl ? "Checking URL…" : "Enter YouTube Live URL to preview"}
          </Text>
        </View>
      )}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="https://www.youtube.com/live/..."
          placeholderTextColor={Colors.light.textMuted}
          value={youtubeUrl}
          onChangeText={onYoutubeUrlChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000" },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  placeholderText: { fontSize: 14, color: Colors.light.textMuted, textAlign: "center", paddingHorizontal: 24 },
  inputBar: {
    padding: 12,
    backgroundColor: "#111827",
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  input: {
    backgroundColor: "#1F2937",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#fff",
  },
});
