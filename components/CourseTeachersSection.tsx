import React from "react";
import { View, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import CourseTeacherAboutCard from "@/components/CourseTeacherAboutCard";
import {
  type AboutTeacher,
  MULTI_TEACHER_GAP,
  isMultiTeacherNarrowLayout,
  multiTeacherScrollCardWidth,
} from "@/lib/course-about-teachers";

type ThemeColors = {
  text: string;
  textSecondary: string;
  border: string;
  card?: string;
};

type Props = {
  teachers: AboutTeacher[];
  isMultiSubject: boolean;
  colors: ThemeColors;
};

export default function CourseTeachersSection({ teachers, isMultiSubject, colors }: Props) {
  const { width } = useWindowDimensions();

  if (teachers.length === 0) return null;

  if (!isMultiSubject || teachers.length === 1) {
    return (
      <View style={styles.singleWrap}>
        {teachers.map((teacher, index) => (
          <CourseTeacherAboutCard
            key={`${teacher.name}-${index}`}
            teacher={teacher}
            colors={colors}
          />
        ))}
      </View>
    );
  }

  if (isMultiTeacherNarrowLayout(width)) {
    const cardWidth = multiTeacherScrollCardWidth(width);
    const snapInterval = cardWidth + MULTI_TEACHER_GAP;
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        snapToInterval={snapInterval}
        decelerationRate="fast"
        disableIntervalMomentum
      >
        {teachers.map((teacher, index) => (
          <CourseTeacherAboutCard
            key={`${teacher.name}-${index}`}
            teacher={teacher}
            colors={colors}
            cardWidth={cardWidth}
            style={index < teachers.length - 1 ? styles.scrollCardGap : undefined}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.desktopWrap}>
      {teachers.map((teacher, index) => (
        <CourseTeacherAboutCard
          key={`${teacher.name}-${index}`}
          teacher={teacher}
          colors={colors}
          style={styles.desktopCard}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  singleWrap: { gap: MULTI_TEACHER_GAP, marginTop: 4 },
  scrollContent: { paddingVertical: 2, paddingRight: 4 },
  scrollCardGap: { marginRight: MULTI_TEACHER_GAP },
  desktopWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: MULTI_TEACHER_GAP,
    marginTop: 4,
  },
  desktopCard: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 300,
    maxWidth: "100%",
    width: "auto" as any,
  },
});
