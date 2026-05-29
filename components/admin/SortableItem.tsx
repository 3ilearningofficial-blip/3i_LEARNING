/**
 * SortableItem — wraps a single admin list item with @dnd-kit drag-and-drop.
 * Web only; on native the drag handle is hidden and up/down arrows remain.
 */
import React from "react";
import { View, Platform, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// @dnd-kit is only available on web
let useSortable: any = null;
let CSS: any = null;
if (Platform.OS === "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sortable = require("@dnd-kit/sortable");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const utilities = require("@dnd-kit/utilities");
    useSortable = sortable.useSortable;
    CSS = utilities.CSS;
  } catch {
    /* dnd-kit not available */
  }
}

type Props = {
  id: string | number;
  children: React.ReactNode;
};

export default function SortableItem({ id, children }: Props) {
  if (Platform.OS !== "web" || !useSortable) {
    return <View>{children}</View>;
  }
  return <SortableItemWeb id={id}>{children}</SortableItemWeb>;
}

function SortableItemWeb({ id, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
    zIndex: isDragging ? 9999 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style}>
      <View style={styles.row}>
        {/* Drag handle — only shown on web */}
        <View
          style={styles.handle}
          {...attributes}
          {...listeners}
        >
          <Ionicons name="reorder-two-outline" size={20} color="#9CA3AF" />
        </View>
        <View style={styles.content}>{children}</View>
      </View>
    </div>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  handle: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    cursor: "grab" as any,
    justifyContent: "center",
    alignItems: "center",
  },
  content: { flex: 1 },
});
