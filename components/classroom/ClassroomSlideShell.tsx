import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { View, StyleSheet, Platform } from "react-native";

export type ClassroomSlideShellHandle = {
  getSlideFrameElement: () => HTMLElement | null;
};

type Props = {
  toolbar?: React.ReactNode;
  thumbnails?: React.ReactNode;
  children: React.ReactNode;
};

const ClassroomSlideShell = forwardRef<ClassroomSlideShellHandle, Props>(function ClassroomSlideShell(
  { toolbar, thumbnails, children },
  ref
) {
  const slideDivRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({
    getSlideFrameElement: () => {
      if (Platform.OS !== "web") return null;
      return slideDivRef.current;
    },
  }));

  if (Platform.OS !== "web") {
    return (
      <View style={styles.outer}>
        {toolbar}
        <View style={styles.stage}>{children}</View>
        {thumbnails}
      </View>
    );
  }

  return (
    <View style={styles.outer}>
      {toolbar ? <View style={styles.toolbarSlot}>{toolbar}</View> : null}
      <View style={styles.stage}>
        <div
          ref={slideDivRef}
          data-classroom-slide-frame="true"
          style={{
            width: "100%",
            maxHeight: "100%",
            aspectRatio: "16 / 9",
            maxWidth: "100%",
            position: "relative",
            overflow: "hidden",
            background: "#0a0a0a",
            borderRadius: 6,
            border: "1px solid #1f2937",
          }}
        >
          {children as React.ReactNode}
        </div>
      </View>
      {thumbnails ? <View style={styles.thumbSlot}>{thumbnails}</View> : null}
    </View>
  );
});

export default ClassroomSlideShell;

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    minHeight: 0,
    backgroundColor: "#0a0a0a",
  },
  toolbarSlot: {
    zIndex: 20,
    backgroundColor: "#111827",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  stage: {
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  thumbSlot: {
    zIndex: 20,
    backgroundColor: "#111827",
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    maxHeight: 88,
  },
});
