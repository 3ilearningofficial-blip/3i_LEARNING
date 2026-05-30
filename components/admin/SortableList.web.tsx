/**
 * SortableList — wraps a list of items with @dnd-kit drag-and-drop on web.
 * Pass children that are wrapped in <SortableItem id={...}>.
 * onReorder is called with the new ordered array of IDs after a drag.
 */
import React from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

type Props = {
  ids: (string | number)[];
  onReorder: (activeId: string | number, overId: string | number) => void;
  children: React.ReactNode;
};

export default function SortableList({ ids, onReorder, children }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // 5px movement before drag starts
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorder(active.id, over.id);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}
