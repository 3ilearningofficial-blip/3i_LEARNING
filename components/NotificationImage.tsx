import React from "react";
import { View, Image, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NOTIFICATION_IMAGE_ASPECT } from "@/constants/notificationImage";
import { resolveNotificationImageUrl } from "@/lib/notificationImageUrl";

type Props = {
  uri?: string | null;
  backgroundColor?: string;
  style?: object;
};

export default function NotificationImage({
  uri,
  backgroundColor = "#F8FAFC",
  style,
}: Props) {
  const resolved = React.useMemo(() => resolveNotificationImageUrl(uri || ""), [uri]);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [resolved]);

  if (!resolved || failed) {
    return (
      <View style={[styles.container, { backgroundColor }, style]}>
        {resolved && failed ? (
          <Ionicons name="image-outline" size={32} color="#94A3B8" />
        ) : null}
      </View>
    );
  }

  if (Platform.OS === "web" && typeof window !== "undefined") {
    return (
      <View style={[styles.container, { backgroundColor }, style, { overflow: "hidden", padding: 0 }]}>
        {React.createElement("img", {
          src: resolved,
          alt: "",
          referrerPolicy: "strict-origin-when-cross-origin",
          style: {
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "contain",
          },
          onError: () => setFailed(true),
          loading: "lazy",
          decoding: "async",
        })}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor }, style]}>
      <Image
        source={{ uri: resolved }}
        style={styles.image}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    aspectRatio: NOTIFICATION_IMAGE_ASPECT,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
