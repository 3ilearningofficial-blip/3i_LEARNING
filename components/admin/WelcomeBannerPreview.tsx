import React, { useState } from "react";
import { View, Pressable, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WelcomeBannerSlide } from "@/components/WelcomeBannerCarousel";
import { WELCOME_BANNER_ASPECT, WELCOME_BANNER_RECOMMENDED } from "@/constants/courseBanner";
import Colors from "@/constants/colors";

type Props = {
  uri: string;
  onClear: () => void;
  showHint?: boolean;
};

/** Welcome carousel preview — same 3:1 cover frame as public carousel. */
export default function WelcomeBannerPreview({ uri, onClear, showHint = true }: Props) {
  const [previewWidth, setPreviewWidth] = useState(320);
  const previewHeight = previewWidth / WELCOME_BANNER_ASPECT;

  const onPreviewLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - previewWidth) > 1) setPreviewWidth(w);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.previewBox} onLayout={onPreviewLayout}>
        <WelcomeBannerSlide
          uri={uri}
          width={previewWidth}
          height={previewHeight}
          backgroundColor="#F8FAFC"
        />
        <Pressable style={styles.clearBtn} onPress={onClear} hitSlop={8}>
          <Ionicons name="close" size={14} color="#fff" />
        </Pressable>
      </View>
      {showHint ? (
        <Text style={styles.hint}>
          Recommended: {WELCOME_BANNER_RECOMMENDED} (3:1). Banner fills edge-to-edge; keep key content centered — may crop slightly on wide screens.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  previewBox: {
    width: "100%",
    aspectRatio: WELCOME_BANNER_ASPECT,
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
