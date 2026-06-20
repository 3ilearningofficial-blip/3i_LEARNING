import React from "react";
import { View, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { COURSE_BANNER_ASPECT } from "@/constants/courseBanner";

type Props = {
  uri?: string | null;
  fallbackColors?: [string, string];
  backgroundColor?: string;
  style?: object;
};

export default function CourseBannerImage({
  uri,
  fallbackColors = ["#0A1628", "#1A2E50"],
  backgroundColor = "#0A1628",
  style,
}: Props) {
  return (
    <View style={[styles.container, { backgroundColor }, style]}>
      {!uri ? (
        <LinearGradient colors={fallbackColors} style={StyleSheet.absoluteFillObject} />
      ) : (
        <Image source={{ uri }} style={styles.image} resizeMode="contain" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    aspectRatio: COURSE_BANNER_ASPECT,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
