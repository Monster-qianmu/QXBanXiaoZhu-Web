import { describe, expect, it } from "vitest";
import {
  buildGridSeats,
  normalizeSeatLayout,
  resizeSeatGrid,
  scaleSeatLayout,
  seatMetrics,
  seatTableFrame,
  SEAT_CELL_HEIGHT,
  SEAT_CELL_WIDTH,
  SEAT_PAPER_HEIGHT,
  SEAT_PAPER_WIDTH,
  snapSeatPosition
} from "./seats";
import type { SeatLayout } from "./types";

function layout(): SeatLayout {
  return {
    version: 1,
    source_excel_path: "",
    student_names: ["张三", "李四"],
    rows: 5,
    columns: 5,
    left: 350,
    top: 246,
    row_label_position: "left",
    title_text: "班级座位表",
    seats: buildGridSeats(350, 246, 5, 5, ["张三", "李四"])
  };
}

describe("seat layout helpers", () => {
  it("fills students from the first row near the platform", () => {
    const seats = layout().seats;

    expect(seats[20].name).toBe("张三");
    expect(seats[21].name).toBe("李四");
  });

  it("snaps seats near original grid lines", () => {
    const base = layout();
    const snapped = snapSeatPosition(base, base.left + SEAT_CELL_WIDTH + 4, base.top + SEAT_CELL_HEIGHT - 6);

    expect(snapped).toEqual({ x: base.left + SEAT_CELL_WIDTH, y: base.top + SEAT_CELL_HEIGHT });
  });

  it("snaps seats to extended grid lines outside the original columns", () => {
    const base = layout();
    const snapped = snapSeatPosition(base, base.left + SEAT_CELL_WIDTH * 5 + 5, base.top + SEAT_CELL_HEIGHT * 2 + 5);

    expect(snapped).toEqual({ x: base.left + SEAT_CELL_WIDTH * 5, y: base.top + SEAT_CELL_HEIGHT * 2 });
  });

  it("keeps resized dimensions within 1 to 12", () => {
    const resized = resizeSeatGrid(layout(), 20, 0);

    expect(resized.rows).toBe(12);
    expect(resized.columns).toBe(1);
  });

  it("scales the seating content without changing the A4 paper size", () => {
    const scaled = scaleSeatLayout(layout(), 60);
    const metrics = seatMetrics(scaled);

    expect(SEAT_PAPER_WIDTH).toBe(1120);
    expect(SEAT_PAPER_HEIGHT).toBe(792);
    expect(scaled.scale_percent).toBe(60);
    expect(metrics.cellWidth).toBeGreaterThan(SEAT_CELL_WIDTH);
    expect(scaled.seats[20].x).toBeCloseTo(scaled.left);
  });

  it("keeps the platform frame aligned with the seating grid", () => {
    const scaled = scaleSeatLayout(layout(), 60);
    const metrics = seatMetrics(scaled);
    const frame = seatTableFrame(scaled);

    expect(frame.left).toBeCloseTo(scaled.left);
    expect(frame.width).toBeCloseTo(scaled.columns * metrics.cellWidth);
    expect(frame.platformTop).toBeCloseTo(scaled.top + scaled.rows * metrics.cellHeight);
  });

  it("aligns legacy regular grids to the current seat metrics", () => {
    const legacy = {
      ...layout(),
      version: 3,
      scale_percent: 41.35338345864661,
      seats: buildGridSeats(350, 246, 5, 5, ["张三", "李四"], { cellWidth: 84, cellHeight: 48 })
    };
    const normalized = normalizeSeatLayout(legacy);

    expect(normalized.seats[1].x - normalized.seats[0].x).toBeCloseTo(SEAT_CELL_WIDTH);
    expect(normalized.seats[5].y - normalized.seats[0].y).toBeCloseTo(SEAT_CELL_HEIGHT);
  });
});
