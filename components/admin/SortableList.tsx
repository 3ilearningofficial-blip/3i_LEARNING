/**
 * SortableList — wraps a list of items with @dnd-kit drag-and-drop on web.
 * Pass children that are wrapped in <SortableItem id={...}>.
 * onReorder is called with the new ordered array of IDs after a drag.
 */
import React from "react";
import { Platform } from "react-native";

let DndContext: any = null;
let SortableContext: any = null;
let verticalListSortingStrategy: any = null;
let closestCenter: any = null;
let PointerSensor: any = null;
let useSensor: any = null;
let useSensors: any = null;
let DragEndEvent: any = null;

if (Platform.OS === "web") {
  try {
    const core = require("@dnd-kit/core");
    const sortable = require("@dnd-kit/sortable");
    DndContext = core.DndContext;
    closestCenter = core.closestCenter;
    PointerSensor = core.PointerSensor;
    useSensor = core.useSensor;
    useSensors = core.useSensors;
    SortableContext = sortable.SortableContext;
    verticalListSortingStrategy = sortable.verticalListSortingStrategy;
  } catch {
    /* dnd-kit not available */
  }
}

type Props = {
  ids: Array<string | number>;
  onReorder: (activeId: string | number, overId: string | number) => void;
  children: React.ReactNode;
};

export default function SortableList({ ids, onReorder, children }: Props) {
  if (Platform.OS !== "web" || !DndContext) {
    return <>{children}</>;
  }
  return <SortableListWeb ids={ids} onReorder={onReorder}>{children}</SortableListWeb>;
}

function SortableListWeb({ ids, onReorder, children }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // 5px movement before drag starts
    })
  );

  const handleDragEnd = (event: any) => {
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
