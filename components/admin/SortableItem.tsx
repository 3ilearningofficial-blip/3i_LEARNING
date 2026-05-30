/**
 * SortableItem — wraps a single admin list item with @dnd-kit drag-and-drop.
 * Web only; on native the drag handle is hidden and up/down arrows remain.
 */
import React from "react";
import { View } from "react-native";

type Props = {
  id: string | number;
  children: React.ReactNode;
};

export default function SortableItem({ children }: Props) {
  return <View>{children}</View>;
}
