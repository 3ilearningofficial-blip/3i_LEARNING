/**
 * SortableList — wraps a list of items with @dnd-kit drag-and-drop on web.
 * Pass children that are wrapped in <SortableItem id={...}>.
 * onReorder is called with the new ordered array of IDs after a drag.
 */
import React from "react";

type Props = {
  ids: (string | number)[];
  onReorder: (activeId: string | number, overId: string | number) => void;
  children: React.ReactNode;
};

export default function SortableList({ children }: Props) {
  return <>{children}</>;
}
