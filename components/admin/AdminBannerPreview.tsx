import React from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import CourseBannerImage from "@/components/CourseBannerImage";
import { COURSE_BANNER_RECOMMENDED } from "@/constants/courseBanner";
import Colors from "@/constants/colors";

type Props = {
  uri: string;
  onClear: () => void;
  showHint?: boolean;
};

export default function AdminBannerPreview({ uri, onClear, showHint = true }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.previewBox}>
        <CourseBannerImage uri={uri} backgroundColor="#F8FAFC" />
        <Pressable style={styles.clearBtn} onPress={onClear} hitSlop={8}>
          <Ionicons name="close" size={14} color="#fff" />
        </Pressable>
      </View>
      {showHint ? (
        <Text style={styles.hint}>Recommended: {COURSE_BANNER_RECOMMENDED} (8:3 ratio)</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  previewBox: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.light.border,
    position: "relative",
  },
  clearBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#EF4444",
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  hint: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textMuted,
    marginTop: 6,
  },
});
