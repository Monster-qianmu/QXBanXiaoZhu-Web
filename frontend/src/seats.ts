import type { Seat, SeatLayout } from "./types";

type RowLabelPosition = SeatLayout["row_label_position"];

export type SeatMetrics = {
  scalePercent: number;
  scaleFactor: number;
  cellWidth: number;
  cellHeight: number;
  platformHeight: number;
  titleOffset: number;
  rowLabelSpace: number;
};

export type SeatTableFrame = {
  left: number;
  top: number;
  width: number;
  seatHeight: number;
  platformTop: number;
  platformHeight: number;
};

export const SEAT_PAPER_WIDTH = 1120;
export const SEAT_PAPER_HEIGHT = 792;
export const SEAT_CELL_WIDTH = 88;
export const SEAT_CELL_HEIGHT = 50;
export const SEAT_PLATFORM_HEIGHT = 60;
export const SEAT_EDGE_PADDING = 28;
export const SEAT_TITLE_OFFSET = 76;
export const SEAT_ROW_LABEL_SPACE = 86;
export const SEAT_DEFAULT_SCALE_PERCENT = 60;
export const SEAT_DEFAULT_ROW_LABEL_POSITION: RowLabelPosition = "none";
export const SEAT_SCALE_MIN_PERCENT = 5;
export const SEAT_SCALE_MAX_PERCENT = 100;
export const SEAT_SNAP_DISTANCE = 18;
export const SEAT_MOVE_STEP = 12;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampDimension(value: number): number {
  return Math.max(1, Math.min(12, Math.round(value || 1)));
}

export function paperAvailableWidth(): number {
  return SEAT_PAPER_WIDTH - SEAT_EDGE_PADDING * 2;
}

export function defaultScalePercentForColumns(columns: number): number {
  return (clampDimension(columns) * SEAT_CELL_WIDTH * 100) / paperAvailableWidth();
}

export function maxScalePercentForLayout(rows: number, columns: number, rowLabelPosition: RowLabelPosition = "left"): number {
  const nextRows = clampDimension(rows);
  const nextColumns = clampDimension(columns);
  const labelSpace = rowLabelPosition === "none" ? 0 : SEAT_ROW_LABEL_SPACE;
  const maxScaleByWidth = paperAvailableWidth() / (nextColumns * SEAT_CELL_WIDTH + labelSpace);
  const maxScaleByHeight = (SEAT_PAPER_HEIGHT - SEAT_EDGE_PADDING * 2) / (nextRows * SEAT_CELL_HEIGHT + SEAT_PLATFORM_HEIGHT + SEAT_TITLE_OFFSET);
  const maxScale = Math.max(0.01, Math.min(maxScaleByWidth, maxScaleByHeight));
  const maxPercent = (maxScale * nextColumns * SEAT_CELL_WIDTH * 100) / paperAvailableWidth();
  return Math.max(SEAT_SCALE_MIN_PERCENT, Math.min(SEAT_SCALE_MAX_PERCENT, maxPercent));
}

export function clampScalePercent(value: number | null | undefined, rows: number, columns: number, rowLabelPosition: RowLabelPosition = "left"): number {
  const fallback = defaultScalePercentForColumns(columns);
  const parsed = Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  return Math.max(SEAT_SCALE_MIN_PERCENT, Math.min(maxScalePercentForLayout(rows, columns, rowLabelPosition), parsed));
}

export function seatMetricsForValues(rows: number, columns: number, scalePercent: number | null | undefined, rowLabelPosition: RowLabelPosition = "left"): SeatMetrics {
  const nextRows = clampDimension(rows);
  const nextColumns = clampDimension(columns);
  const percent = clampScalePercent(scalePercent, nextRows, nextColumns, rowLabelPosition);
  const gridWidth = (paperAvailableWidth() * percent) / 100;
  const scaleFactor = gridWidth / (nextColumns * SEAT_CELL_WIDTH);
  return {
    scalePercent: percent,
    scaleFactor,
    cellWidth: SEAT_CELL_WIDTH * scaleFactor,
    cellHeight: SEAT_CELL_HEIGHT * scaleFactor,
    platformHeight: SEAT_PLATFORM_HEIGHT * scaleFactor,
    titleOffset: SEAT_TITLE_OFFSET * scaleFactor,
    rowLabelSpace: SEAT_ROW_LABEL_SPACE * scaleFactor
  };
}

function alignRegularGridSeats(layout: SeatLayout, metrics: SeatMetrics): Seat[] {
  const seats = layout.seats ?? [];
  const gridCount = Math.min(seats.length, layout.rows * layout.columns);
  if (gridCount < 2) return seats;

  const firstSeat = seats[0];
  const inferredCellWidth = layout.columns > 1 && seats[1] ? seats[1].x - firstSeat.x : metrics.cellWidth;
  const inferredCellHeight = layout.rows > 1 && seats[layout.columns] ? seats[layout.columns].y - firstSeat.y : metrics.cellHeight;
  if (inferredCellWidth <= 0 || inferredCellHeight <= 0) return seats;
  if (Math.abs(inferredCellWidth - metrics.cellWidth) < 0.5 && Math.abs(inferredCellHeight - metrics.cellHeight) < 0.5) return seats;

  const tolerance = Math.max(2, Math.min(inferredCellWidth, inferredCellHeight) * 0.06);
  for (let index = 0; index < gridCount; index += 1) {
    const row = Math.floor(index / layout.columns);
    const column = index % layout.columns;
    const expectedX = layout.left + column * inferredCellWidth;
    const expectedY = layout.top + row * inferredCellHeight;
    const seat = seats[index];
    if (Math.abs(seat.x - expectedX) > tolerance || Math.abs(seat.y - expectedY) > tolerance) {
      return seats;
    }
  }

  return seats.map((seat) => {
    const relativeColumn = (seat.x - layout.left) / inferredCellWidth;
    const relativeRow = (seat.y - layout.top) / inferredCellHeight;
    const nearGridColumn = Math.abs(relativeColumn - Math.round(relativeColumn)) <= 0.08;
    const nearGridRow = Math.abs(relativeRow - Math.round(relativeRow)) <= 0.08;
    if (!nearGridColumn || !nearGridRow) return seat;
    return {
      ...seat,
      x: round2(layout.left + relativeColumn * metrics.cellWidth),
      y: round2(layout.top + relativeRow * metrics.cellHeight)
    };
  });
}

export function normalizeSeatLayout(layout: SeatLayout): SeatLayout {
  const rows = clampDimension(layout.rows);
  const columns = clampDimension(layout.columns);
  const rowLabelPosition = ["left", "right", "none"].includes(layout.row_label_position) ? layout.row_label_position : SEAT_DEFAULT_ROW_LABEL_POSITION;
  const scalePercent = clampScalePercent(layout.scale_percent, rows, columns, rowLabelPosition);
  const normalized = {
    ...layout,
    version: Math.max(layout.version ?? 3, 3),
    rows,
    columns,
    row_label_position: rowLabelPosition,
    scale_percent: scalePercent,
    seats: layout.seats ?? []
  };
  const metrics = seatMetricsForValues(rows, columns, scalePercent, rowLabelPosition);
  return { ...normalized, seats: alignRegularGridSeats(normalized, metrics) };
}

export function seatMetrics(layout: SeatLayout): SeatMetrics {
  const normalized = normalizeSeatLayout(layout);
  return seatMetricsForValues(normalized.rows, normalized.columns, normalized.scale_percent, normalized.row_label_position);
}

export function seatTableFrame(layout: SeatLayout): SeatTableFrame {
  const normalized = normalizeSeatLayout(layout);
  const metrics = seatMetrics(normalized);
  const seatHeight = normalized.rows * metrics.cellHeight;
  return {
    left: normalized.left,
    top: normalized.top,
    width: normalized.columns * metrics.cellWidth,
    seatHeight,
    platformTop: normalized.top + seatHeight,
    platformHeight: metrics.platformHeight
  };
}

export function defaultLeftForColumns(columns: number, scalePercent?: number, rowLabelPosition: RowLabelPosition = "left", rows = 5): number {
  const nextColumns = clampDimension(columns);
  const metrics = seatMetricsForValues(rows, nextColumns, scalePercent, rowLabelPosition);
  const tableWidth = nextColumns * metrics.cellWidth;
  const labelSpace = rowLabelPosition === "none" ? 0 : metrics.rowLabelSpace;
  const contentWidth = tableWidth + labelSpace;
  const contentLeft = Math.max(SEAT_EDGE_PADDING, (SEAT_PAPER_WIDTH - contentWidth) / 2);
  return rowLabelPosition === "left" ? contentLeft + labelSpace : contentLeft;
}

export function defaultTopForRows(rows: number, scalePercent?: number, columns = 5, rowLabelPosition: RowLabelPosition = "left"): number {
  const nextRows = clampDimension(rows);
  const metrics = seatMetricsForValues(nextRows, columns, scalePercent, rowLabelPosition);
  const tableHeight = nextRows * metrics.cellHeight + metrics.platformHeight;
  return Math.max(SEAT_EDGE_PADDING + metrics.titleOffset, (SEAT_PAPER_HEIGHT - tableHeight) / 2);
}

export function orderedSeatNamesNearPlatform(layout: SeatLayout): string[] {
  return [...(layout.seats ?? [])]
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 1) return b.y - a.y;
      return a.x - b.x;
    })
    .map((seat) => seat.name);
}

export function buildGridSeats(left: number, top: number, rows: number, columns: number, names: string[], metrics?: Pick<SeatMetrics, "cellWidth" | "cellHeight">): Seat[] {
  const nextRows = clampDimension(rows);
  const nextColumns = clampDimension(columns);
  const cellWidth = metrics?.cellWidth ?? SEAT_CELL_WIDTH;
  const cellHeight = metrics?.cellHeight ?? SEAT_CELL_HEIGHT;
  const seats: Seat[] = [];
  for (let row = 0; row < nextRows; row += 1) {
    for (let column = 0; column < nextColumns; column += 1) {
      const nameIndex = (nextRows - 1 - row) * nextColumns + column;
      seats.push({
        name: names[nameIndex] ?? "",
        x: round2(left + column * cellWidth),
        y: round2(top + row * cellHeight)
      });
    }
  }
  return seats;
}

export function resizeSeatGrid(layout: SeatLayout, rows: number, columns: number): SeatLayout {
  const normalized = normalizeSeatLayout(layout);
  const nextRows = clampDimension(rows);
  const nextColumns = clampDimension(columns);
  const rowLabelPosition = normalized.row_label_position;
  const scalePercent = clampScalePercent(normalized.scale_percent, nextRows, nextColumns, rowLabelPosition);
  const metrics = seatMetricsForValues(nextRows, nextColumns, scalePercent, rowLabelPosition);
  const names = orderedSeatNamesNearPlatform(normalized);
  const minLeft = SEAT_EDGE_PADDING + (rowLabelPosition === "left" ? metrics.rowLabelSpace : 0);
  const maxLeft = SEAT_PAPER_WIDTH - SEAT_EDGE_PADDING - nextColumns * metrics.cellWidth - (rowLabelPosition === "right" ? metrics.rowLabelSpace : 0);
  const minTop = SEAT_EDGE_PADDING + metrics.titleOffset;
  const maxTop = SEAT_PAPER_HEIGHT - SEAT_EDGE_PADDING - nextRows * metrics.cellHeight - metrics.platformHeight;
  const nextLeft = round2(Math.max(minLeft, Math.min(maxLeft, Number.isFinite(normalized.left) ? normalized.left : defaultLeftForColumns(nextColumns, scalePercent, rowLabelPosition, nextRows))));
  const nextTop = round2(Math.max(minTop, Math.min(maxTop, Number.isFinite(normalized.top) ? normalized.top : defaultTopForRows(nextRows, scalePercent, nextColumns, rowLabelPosition))));
  return moveSeatLayout(
    {
      ...normalized,
      rows: nextRows,
      columns: nextColumns,
      left: nextLeft,
      top: nextTop,
      scale_percent: scalePercent,
      seats: buildGridSeats(nextLeft, nextTop, nextRows, nextColumns, names, metrics)
    },
    0,
    0
  );
}

function closestSnapLine(value: number, candidates: number[], maxDistance: number): number {
  let closest = value;
  let distance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate) => {
    const nextDistance = Math.abs(value - candidate);
    if (nextDistance < distance) {
      closest = candidate;
      distance = nextDistance;
    }
  });
  return distance <= maxDistance ? closest : value;
}

function nearestGridLine(value: number, start: number, step: number, min: number, max: number): number[] {
  if (!Number.isFinite(step) || step <= 0) return [];
  const index = Math.round((value - start) / step);
  const line = start + index * step;
  return line >= min && line <= max ? [line] : [];
}

function snapDistanceForMetrics(metrics: SeatMetrics): number {
  return Math.max(SEAT_SNAP_DISTANCE, Math.min(metrics.cellWidth, metrics.cellHeight) * 0.28);
}

export function clampSeatPosition(layout: SeatLayout, x: number, y: number): { x: number; y: number } {
  const normalized = normalizeSeatLayout(layout);
  const metrics = seatMetrics(normalized);
  const platformTop = normalized.top + normalized.rows * metrics.cellHeight;
  const minX = SEAT_EDGE_PADDING;
  const maxX = SEAT_PAPER_WIDTH - SEAT_EDGE_PADDING - metrics.cellWidth;
  const minY = SEAT_EDGE_PADDING + metrics.titleOffset;
  const maxY = Math.max(minY, platformTop - metrics.cellHeight);
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y))
  };
}

export function snapSeatPosition(layout: SeatLayout, x: number, y: number): { x: number; y: number } {
  const normalized = normalizeSeatLayout(layout);
  const metrics = seatMetrics(normalized);
  const frame = seatTableFrame(normalized);
  const minX = SEAT_EDGE_PADDING;
  const maxX = SEAT_PAPER_WIDTH - SEAT_EDGE_PADDING - metrics.cellWidth;
  const minY = SEAT_EDGE_PADDING + metrics.titleOffset;
  const maxY = Math.max(minY, frame.platformTop - metrics.cellHeight);
  const distance = snapDistanceForMetrics(metrics);
  const xCandidates = [
    ...nearestGridLine(x, normalized.left, metrics.cellWidth, minX, maxX),
    ...normalized.seats.map((seat) => seat.x).filter((value) => value >= minX && value <= maxX)
  ];
  const yCandidates = [
    ...nearestGridLine(y, normalized.top, metrics.cellHeight, minY, maxY),
    ...normalized.seats.map((seat) => seat.y).filter((value) => value >= minY && value <= maxY)
  ];
  const snapped = {
    x: round2(closestSnapLine(x, xCandidates, distance)),
    y: round2(closestSnapLine(y, yCandidates, distance))
  };
  return clampSeatPosition(normalized, snapped.x, snapped.y);
}

export function layoutContentBounds(layout: SeatLayout): { left: number; top: number; right: number; bottom: number } {
  const normalized = normalizeSeatLayout(layout);
  const metrics = seatMetrics(normalized);
  const frame = seatTableFrame(normalized);
  const seatBounds = (normalized.seats ?? []).reduce(
    (bounds, seat) => ({
      left: Math.min(bounds.left, seat.x),
      top: Math.min(bounds.top, seat.y),
      right: Math.max(bounds.right, seat.x + metrics.cellWidth),
      bottom: Math.max(bounds.bottom, seat.y + metrics.cellHeight)
    }),
    {
      left: frame.left,
      top: frame.top,
      right: frame.left + frame.width,
      bottom: frame.platformTop
    }
  );
  const labelLeft = normalized.row_label_position === "left" ? frame.left - metrics.rowLabelSpace : frame.left;
  const labelRight =
    normalized.row_label_position === "right"
      ? frame.left + frame.width + metrics.rowLabelSpace
      : frame.left + frame.width;
  return {
    left: Math.min(seatBounds.left, labelLeft),
    top: Math.min(seatBounds.top, frame.top - metrics.titleOffset),
    right: Math.max(seatBounds.right, labelRight),
    bottom: Math.max(seatBounds.bottom, frame.platformTop + frame.platformHeight)
  };
}

export function moveSeatLayout(layout: SeatLayout, dx: number, dy: number): SeatLayout {
  const normalized = normalizeSeatLayout(layout);
  const bounds = layoutContentBounds(normalized);
  let nextDx = dx;
  let nextDy = dy;
  if (bounds.left + nextDx < SEAT_EDGE_PADDING) nextDx = SEAT_EDGE_PADDING - bounds.left;
  if (bounds.right + nextDx > SEAT_PAPER_WIDTH - SEAT_EDGE_PADDING) nextDx = SEAT_PAPER_WIDTH - SEAT_EDGE_PADDING - bounds.right;
  if (bounds.top + nextDy < SEAT_EDGE_PADDING) nextDy = SEAT_EDGE_PADDING - bounds.top;
  if (bounds.bottom + nextDy > SEAT_PAPER_HEIGHT - SEAT_EDGE_PADDING) nextDy = SEAT_PAPER_HEIGHT - SEAT_EDGE_PADDING - bounds.bottom;
  return {
    ...normalized,
    left: round2(normalized.left + nextDx),
    top: round2(normalized.top + nextDy),
    seats: normalized.seats.map((seat) => ({
      ...seat,
      x: round2(seat.x + nextDx),
      y: round2(seat.y + nextDy)
    }))
  };
}

export function scaleSeatLayout(layout: SeatLayout, requestedPercent: number): SeatLayout {
  const normalized = normalizeSeatLayout(layout);
  const currentMetrics = seatMetrics(normalized);
  const nextPercent = clampScalePercent(requestedPercent, normalized.rows, normalized.columns, normalized.row_label_position);
  const nextMetrics = seatMetricsForValues(normalized.rows, normalized.columns, nextPercent, normalized.row_label_position);
  const currentGridWidth = normalized.columns * currentMetrics.cellWidth;
  const currentTableHeight = normalized.rows * currentMetrics.cellHeight + currentMetrics.platformHeight;
  const centerX = normalized.left + currentGridWidth / 2;
  const centerY = normalized.top + currentTableHeight / 2;
  const nextGridWidth = normalized.columns * nextMetrics.cellWidth;
  const nextTableHeight = normalized.rows * nextMetrics.cellHeight + nextMetrics.platformHeight;
  const nextLeft = round2(centerX - nextGridWidth / 2);
  const nextTop = round2(centerY - nextTableHeight / 2);
  const ratioX = nextMetrics.cellWidth / currentMetrics.cellWidth;
  const ratioY = nextMetrics.cellHeight / currentMetrics.cellHeight;
  return moveSeatLayout(
    {
      ...normalized,
      left: nextLeft,
      top: nextTop,
      scale_percent: nextPercent,
      seats: normalized.seats.map((seat) => ({
        ...seat,
        x: round2(nextLeft + (seat.x - normalized.left) * ratioX),
        y: round2(nextTop + (seat.y - normalized.top) * ratioY)
      }))
    },
    0,
    0
  );
}

export function addSeatToLayout(layout: SeatLayout): { layout: SeatLayout; seatIndex: number } {
  const normalized = normalizeSeatLayout(layout);
  const metrics = seatMetrics(normalized);
  const platformTop = normalized.top + normalized.rows * metrics.cellHeight;
  const preferred = clampSeatPosition(normalized, normalized.left + normalized.columns * metrics.cellWidth + 24 * metrics.scaleFactor, platformTop - metrics.cellHeight);
  const seat = { name: "新座位", x: round2(preferred.x), y: round2(preferred.y) };
  return {
    layout: { ...normalized, seats: [...normalized.seats, seat] },
    seatIndex: normalized.seats.length
  };
}
