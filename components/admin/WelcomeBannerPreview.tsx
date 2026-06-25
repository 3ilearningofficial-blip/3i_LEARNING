import React, { useState } from "react";
import { View, Pressable, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WelcomeBannerSlide } from "@/components/WelcomeBannerCarousel";
import {
  WELCOME_BANNER_ASPECT,
  WELCOME_BANNER_DESKTOP_ASPECT,
  WELCOME_BANNER_MOBILE_RECOMMENDED,
  WELCOME_BANNER_DESKTOP_RECOMMENDED,
} from "@/constants/courseBanner";
import Colors from "@/constants/colors";

type Props = {
  uri: string;
  variant: "mobile" | "desktop";
  onClear: () => void;
  showHint?: boolean;
};

/** Welcome carousel preview — same cover frame as public carousel for mobile or desktop. */
export default function WelcomeBannerPreview({ uri, variant, onClear, showHint = true }: Props) {
  const aspect = variant === "desktop" ? WELCOME_BANNER_DESKTOP_ASPECT : WELCOME_BANNER_ASPECT;
  const recommended =
    variant === "desktop" ? WELCOME_BANNER_DESKTOP_RECOMMENDED : WELCOME_BANNER_MOBILE_RECOMMENDED;
  const label = variant === "desktop" ? "Desktop (laptop web)" : "Mobile (phone web)";

  const [previewWidth, setPreviewWidth] = useState(160);
  const previewHeight = previewWidth / aspect;

  const onPreviewLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - previewWidth) > 1) setPreviewWidth(w);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.variantLabel}>{label}</Text>
      <View style={[styles.previewBox, { aspectRatio: aspect }]} onLayout={onPreviewLayout}>
        {uri.trim() ? (
          <WelcomeBannerSlide
            uri={uri.trim()}
            width={previewWidth}
            height={previewHeight}
            backgroundColor="#F8FAFC"
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No image</Text>
          </View>
        )}
        {uri.trim() ? (
          <Pressable style={styles.clearBtn} onPress={onClear} hitSlop={8}>
            <Ionicons name="close" size={14} color="#fff" />
          </Pressable>
        ) : null}
      </View>
      {showHint ? (
        <Text style={styles.hint}>
          {recommended}. Edge-to-edge on welcome page{variant === "desktop" ? " (max 230px tall)" : " (~27% of screen width)"}.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0 },
  variantLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    marginBottom: 4,
  },
  previewBox: {
    width: "100%",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.light.border,
    position: "relative",
  },
  placeholder: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
  placeholderText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textMuted,
  },
  clearBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "#EF4444",
    borderRadius: 14,
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  hint: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textMuted,
    marginTop: 4,
    lineHeight: 14,
  },
});
