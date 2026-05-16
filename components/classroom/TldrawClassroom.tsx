import React, { forwardRef } from "react";
import { Platform, View, Text, StyleSheet } from "react-native";
import Colors from "@/constants/colors";
import type { TldrawClassroomHandle } from "./TldrawClassroom.types";

type Props = {
  liveClassId: string;
  readonly?: boolean;
  preview?: boolean;
};

const TldrawClassroom = forwardRef<TldrawClassroomHandle, Props>(function TldrawClassroom(props, ref) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- web-only lazy load for tldraw
    const Web = require("./TldrawClassroom.web").default;
    return <Web ref={ref} {...props} />;
  }
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>Whiteboard is available on web for this live class.</Text>
    </View>
  );
});

export default TldrawClassroom;
export type { TldrawClassroomHandle } from "./TldrawClassroom.types";

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
