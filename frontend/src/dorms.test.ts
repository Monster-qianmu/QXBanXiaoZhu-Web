import { describe, expect, it } from "vitest";
import {
  assignedStudentIdsForRooms,
  assignStudentToBed,
  dormStudentOptionLabel,
  isStudentAssignedElsewhere,
  moveBedStudent,
  reorderBedWithinRoom
} from "./dorms";

describe("dorm student options", () => {
  it("disables a student assigned to another bed", () => {
    const assignedIds = assignedStudentIdsForRooms([
      { number: "501", beds: ["1"] },
      { number: "502", beds: [null] }
    ]);

    expect(isStudentAssignedElsewhere(assignedIds, null, "1")).toBe(true);
    expect(dormStudentOptionLabel("张三", "广州", true)).toBe("张三 广州（已安排）");
  });

  it("keeps the current bed student selectable", () => {
    const assignedIds = assignedStudentIdsForRooms([{ number: "501", beds: ["1"] }]);

    expect(isStudentAssignedElsewhere(assignedIds, "1", "1")).toBe(false);
    expect(dormStudentOptionLabel("张三", "广州", false)).toBe("张三 广州");
  });

  it("assigns a dragged student to a target bed without duplicates", () => {
    const rooms = assignStudentToBed(
      [
        { number: "501", beds: ["1", null] },
        { number: "502", beds: [null] }
      ],
      "1",
      { roomIndex: 1, bedIndex: 0 }
    );

    expect(rooms[0].beds).toEqual([null, null]);
    expect(rooms[1].beds).toEqual(["1"]);
  });

  it("swaps students when dragging an occupied bed to another bed", () => {
    const rooms = moveBedStudent([{ number: "501", beds: ["1", "2"] }], { roomIndex: 0, bedIndex: 0 }, { roomIndex: 0, bedIndex: 1 });

    expect(rooms[0].beds).toEqual(["2", "1"]);
  });

  it("reorders beds within a room", () => {
    const rooms = reorderBedWithinRoom([{ number: "501", beds: ["1", "2", null] }], 0, 0, 2);

    expect(rooms[0].beds).toEqual(["2", null, "1"]);
  });
});
