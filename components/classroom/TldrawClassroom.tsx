import React from "react";
import { Platform, View, Text, StyleSheet } from "react-native";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  readonly?: boolean;
  preview?: boolean;
};

export default function TldrawClassroom(props: Props) {
  if (Platform.OS === "web") {
    const Web = require("./TldrawClassroom.web").default;
    return <Web {...props} />;
  }
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>Whiteboard is available on web for this live class.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
    padding: 24,
  },
  text: { color: Colors.light.textMuted, textAlign: "center", fontSize: 14 },
});
