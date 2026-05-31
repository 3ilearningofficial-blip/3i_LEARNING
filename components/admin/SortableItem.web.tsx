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
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const dragHandleProps = { ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>;

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
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label="Drag to reorder"
          style={handleStyle}
          {...dragHandleProps}
        >
          <Ionicons name="reorder-two-outline" size={20} color="#9CA3AF" />
        </button>
        <View style={styles.content}>{children}</View>
      </View>
    </div>
  );
}

const handleStyle: React.CSSProperties = {
  alignItems: "center",
  background: "transparent",
  border: 0,
  cursor: "grab",
  display: "flex",
  justifyContent: "center",
  padding: "8px 6px",
  touchAction: "none",
  userSelect: "none",
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  content: { flex: 1 },
});
