import { describe, expect, it } from "vitest";
import {
  assignmentCoversSubject,
  findAssignmentForCourse,
  filterRowsBySubjectKey,
  type StaffAssignment,
} from "./staff-access-utils";
import { getDefaultPermissionsForRole, mergePermissionOverrides } from "./staff-permissions";

describe("staff-access-utils", () => {
  const mathsAssignment: StaffAssignment = {
    id: 1,
    user_id: 10,
    course_id: 5,
    subject_key: "maths",
    assigned_at: Date.now(),
  };

  it("finds assignment for matching subject", () => {
    const found = findAssignmentForCourse([mathsAssignment], 5, "maths");
    expect(found?.subject_key).toBe("maths");
  });

  it("rejects wrong subject", () => {
    const found = findAssignmentForCourse([mathsAssignment], 5, "english");
    expect(found).toBeNull();
  });

  it("whole-course assignment covers any subject filter read", () => {
    const whole: StaffAssignment = { ...mathsAssignment, subject_key: null };
    expect(assignmentCoversSubject(whole, "maths")).toBe(true);
  });

  it("filters rows by subject_key", () => {
    const rows = filterRowsBySubjectKey(
      [{ subject_key: "maths" }, { subject_key: "english" }],
      mathsAssignment,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].subject_key).toBe("maths");
  });
});

describe("staff-permissions", () => {
  it("teacher cannot delete tests by default", () => {
    const perms = getDefaultPermissionsForRole("teacher");
    expect(perms["tests.delete"]).toBe(false);
    expect(perms["tests.create"]).toBe(true);
  });

  it("applies overrides", () => {
    const perms = mergePermissionOverrides("teacher", [
      { permission_key: "materials.youtube", allowed: true },
    ]);
    expect(perms["materials.youtube"]).toBe(true);
  });
});
