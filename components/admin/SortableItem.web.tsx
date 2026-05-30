/**
 * SortableItem — wraps a single admin list item with @dnd-kit drag-and-drop.
 * Web only; on native the drag handle is hidden and up/down arrows remain.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Props = {
  id: string | number;
  children: React.ReactNode;
};

export default function SortableItem({ id, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const dragHandleProps = { ...attributes, ...listeners } as any;

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
        {/* Drag handle is web-only; native keeps the existing up/down controls. */}
        <View style={styles.handle} {...dragHandleProps}>
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
