import { describe, expect, it } from "vitest";
import { courseFolderFullName, sortCourseFolderRows, sortFolderNamesByOrder } from "./courseFolderOrder";

describe("courseFolderFullName", () => {
  it("prefers full_name over name", () => {
    expect(courseFolderFullName({ full_name: "A / B", name: "B" })).toBe("A / B");
  });
});

describe("sortFolderNamesByOrder", () => {
  const folders = [
    { type: "lecture", full_name: "Gamma", order_index: 2 },
    { type: "lecture", full_name: "Alpha", order_index: 0 },
    { type: "lecture", full_name: "Beta", order_index: 1 },
    { type: "test", full_name: "Alpha", order_index: 0 },
  ];

  it("sorts by order_index", () => {
    expect(sortFolderNamesByOrder(["Gamma", "Alpha", "Beta"], "lecture", folders)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });

  it("puts unknown folders at the end", () => {
    expect(sortFolderNamesByOrder(["Unknown", "Alpha"], "lecture", folders)).toEqual(["Alpha", "Unknown"]);
  });

  it("scopes by subject_key when provided", () => {
    const scoped = [
      { type: "lecture", full_name: "Maths", order_index: 1, subject_key: "maths" },
      { type: "lecture", full_name: "English", order_index: 0, subject_key: "english" },
    ];
    expect(sortFolderNamesByOrder(["Maths", "English"], "lecture", scoped, { subjectKey: "english" })).toEqual([
      "English",
      "Maths",
    ]);
  });
});

describe("sortCourseFolderRows", () => {
  it("sorts folder objects by order_index", () => {
    const rows = [
      { id: 3, order_index: 2, name: "C" },
      { id: 1, order_index: 0, name: "A" },
      { id: 2, order_index: 1, name: "B" },
    ];
    expect(sortCourseFolderRows(rows).map((r) => r.name)).toEqual(["A", "B", "C"]);
  });
});
