import React from "react";
import { View, Text, Image, StyleSheet, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import type { AboutTeacher } from "@/lib/course-about-teachers";

type ThemeColors = {
  text: string;
  textSecondary: string;
  border: string;
  card?: string;
};

type Props = {
  teacher: AboutTeacher;
  colors?: ThemeColors;
  style?: ViewStyle;
  cardWidth?: number | `${number}%`;
};

export default function CourseTeacherAboutCard({ teacher, colors, style, cardWidth }: Props) {
  const textColor = colors?.text ?? Colors.light.text;
  const bioColor = colors?.textSecondary ?? Colors.light.textSecondary;
  const borderColor = colors?.border ?? Colors.light.border;

  return (
    <View style={[styles.card, { borderColor, width: cardWidth }, style]}>
      {teacher.imageUrl ? (
        <Image source={{ uri: teacher.imageUrl }} style={styles.photo} />
      ) : (
        <View style={[styles.photo, styles.photoFallback]}>
          <Ionicons name="person" size={34} color={Colors.light.primary} />
        </View>
      )}
      <View style={styles.textCol}>
        {teacher.name ? (
          <Text style={[styles.name, { color: textColor }]}>{teacher.name}</Text>
        ) : null}
        <Text style={[styles.bio, { color: bioColor }]}>
          {teacher.bio?.trim() ? teacher.bio : "No description"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    width: "100%",
  },
  photo: {
    width: 92,
    height: 92,
    borderRadius: 18,
    backgroundColor: "#F8FAFC",
  },
  photoFallback: {
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  name: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    lineHeight: 22,
  },
  bio: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
  },
});
