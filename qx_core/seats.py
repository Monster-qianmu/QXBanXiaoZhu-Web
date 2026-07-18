from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from .constants import (
    SEAT_CELL_HEIGHT,
    SEAT_CELL_WIDTH,
    SEAT_DEFAULT_ROW_LABEL_POSITION,
    SEAT_DEFAULT_SCALE_PERCENT,
    SEAT_DEFAULT_LEFT,
    SEAT_DEFAULT_TOP,
    SEAT_EDGE_PADDING,
    SEAT_PAPER_ASPECT,
    SEAT_PAPER_CONTENT_MARGIN_X,
    SEAT_PAPER_CONTENT_MARGIN_Y,
    SEAT_PAPER_HEIGHT,
    SEAT_PAPER_MIN_WIDTH,
    SEAT_PAPER_WIDTH,
    SEAT_PLATFORM_HEIGHT,
    SEAT_ROW_LABEL_SPACE,
    SEAT_SCALE_MAX_PERCENT,
    SEAT_SCALE_MIN_PERCENT,
    SEAT_TITLE_OFFSET,
)
from .models import Seat, SeatLayout, Student


@dataclass(frozen=True)
class SeatMetrics:
    scale_percent: float
    scale_factor: float
    cell_width: float
    cell_height: float
    platform_height: float
    title_offset: float
    row_label_space: float


def clamp_dimension(value: int | str | None, fallback: int = 5) -> int:
    try:
        parsed = int(value) if value is not None else fallback
    except (TypeError, ValueError):
        parsed = fallback
    return max(1, min(12, parsed))


def default_dimensions(student_count: int, preferred_columns: int = 5) -> tuple[int, int]:
    columns = max(5, min(12, preferred_columns))
    if student_count <= 0:
        return 5, 5
    rows = max(5, math.ceil(student_count / columns))
    if rows > 12:
        rows = 12
        columns = max(columns, math.ceil(student_count / rows))
    return max(1, min(12, rows)), max(1, min(12, columns))


def student_name_for_grid_cell(visual_row: int, column: int, students: list[Student], rows: int, columns: int) -> str:
    student_index = (rows - 1 - visual_row) * columns + column
    return students[student_index].name if student_index < len(students) else ""


def paper_available_width() -> float:
    return SEAT_PAPER_WIDTH - SEAT_EDGE_PADDING * 2


def default_scale_percent_for_columns(columns: int) -> float:
    columns = clamp_dimension(columns)
    return columns * SEAT_CELL_WIDTH / paper_available_width() * 100


def max_scale_percent_for_layout(rows: int, columns: int, row_label_position: str = "left") -> float:
    rows = clamp_dimension(rows)
    columns = clamp_dimension(columns)
    label_space = SEAT_ROW_LABEL_SPACE if row_label_position in {"left", "right"} else 0.0
    max_scale_by_width = paper_available_width() / (columns * SEAT_CELL_WIDTH + label_space)
    max_scale_by_height = (SEAT_PAPER_HEIGHT - SEAT_EDGE_PADDING * 2) / (
        rows * SEAT_CELL_HEIGHT + SEAT_PLATFORM_HEIGHT + SEAT_TITLE_OFFSET
    )
    max_scale = max(0.01, min(max_scale_by_width, max_scale_by_height))
    max_percent = max_scale * columns * SEAT_CELL_WIDTH / paper_available_width() * 100
    return max(SEAT_SCALE_MIN_PERCENT, min(SEAT_SCALE_MAX_PERCENT, max_percent))


def clamp_scale_percent(
    value: float | int | str | None,
    rows: int,
    columns: int,
    row_label_position: str = "left",
) -> float:
    fallback = default_scale_percent_for_columns(columns)
    try:
        parsed = float(value) if value not in {None, ""} else fallback
    except (TypeError, ValueError):
        parsed = fallback
    if parsed <= 0:
        parsed = fallback
    maximum = max_scale_percent_for_layout(rows, columns, row_label_position)
    return max(SEAT_SCALE_MIN_PERCENT, min(maximum, parsed))


def seat_metrics_for_values(rows: int, columns: int, scale_percent: float | int | str | None, row_label_position: str = "left") -> SeatMetrics:
    rows = clamp_dimension(rows)
    columns = clamp_dimension(columns)
    percent = clamp_scale_percent(scale_percent, rows, columns, row_label_position)
    grid_width = paper_available_width() * percent / 100
    scale_factor = grid_width / (columns * SEAT_CELL_WIDTH)
    return SeatMetrics(
        scale_percent=percent,
        scale_factor=scale_factor,
        cell_width=SEAT_CELL_WIDTH * scale_factor,
        cell_height=SEAT_CELL_HEIGHT * scale_factor,
        platform_height=SEAT_PLATFORM_HEIGHT * scale_factor,
        title_offset=SEAT_TITLE_OFFSET * scale_factor,
        row_label_space=SEAT_ROW_LABEL_SPACE * scale_factor,
    )


def seat_metrics(layout: SeatLayout) -> SeatMetrics:
    return seat_metrics_for_values(layout.rows, layout.columns, layout.scale_percent, layout.row_label_position)


def align_regular_grid_seats(layout: SeatLayout) -> SeatLayout:
    metrics = seat_metrics(layout)
    seats = layout.seats
    grid_count = min(len(seats), layout.rows * layout.columns)
    if grid_count < 2:
        return layout

    first_seat = seats[0]
    inferred_cell_width = seats[1].x - first_seat.x if layout.columns > 1 and len(seats) > 1 else metrics.cell_width
    inferred_cell_height = seats[layout.columns].y - first_seat.y if layout.rows > 1 and len(seats) > layout.columns else metrics.cell_height
    if inferred_cell_width <= 0 or inferred_cell_height <= 0:
        return layout
    if abs(inferred_cell_width - metrics.cell_width) < 0.5 and abs(inferred_cell_height - metrics.cell_height) < 0.5:
        return layout

    tolerance = max(2.0, min(inferred_cell_width, inferred_cell_height) * 0.06)
    for index, seat in enumerate(seats[:grid_count]):
        row = index // layout.columns
        column = index % layout.columns
        expected_x = layout.left + column * inferred_cell_width
        expected_y = layout.top + row * inferred_cell_height
        if abs(seat.x - expected_x) > tolerance or abs(seat.y - expected_y) > tolerance:
            return layout

    next_seats: list[Seat] = []
    for seat in seats:
        relative_column = (seat.x - layout.left) / inferred_cell_width
        relative_row = (seat.y - layout.top) / inferred_cell_height
        near_grid_column = abs(relative_column - round(relative_column)) <= 0.08
        near_grid_row = abs(relative_row - round(relative_row)) <= 0.08
        if near_grid_column and near_grid_row:
            next_seats.append(
                Seat(
                    name=seat.name,
                    x=layout.left + relative_column * metrics.cell_width,
                    y=layout.top + relative_row * metrics.cell_height,
                )
            )
        else:
            next_seats.append(seat)
    layout.seats = next_seats
    return layout


def default_left_for_columns(
    columns: int,
    scale_percent: float | int | str | None = None,
    row_label_position: str = "left",
    rows: int = 5,
) -> float:
    rows = clamp_dimension(rows)
    columns = clamp_dimension(columns)
    metrics = seat_metrics_for_values(rows, columns, scale_percent, row_label_position)
    table_width = columns * metrics.cell_width
    label_space = metrics.row_label_space if row_label_position in {"left", "right"} else 0.0
    content_width = table_width + label_space
    content_left = max(SEAT_EDGE_PADDING, (SEAT_PAPER_WIDTH - content_width) / 2)
    if row_label_position == "left":
        return content_left + label_space
    return content_left


def default_top_for_rows(rows: int, scale_percent: float | int | str | None = None, columns: int = 5, row_label_position: str = "left") -> float:
    rows = clamp_dimension(rows)
    columns = clamp_dimension(columns)
    metrics = seat_metrics_for_values(rows, columns, scale_percent, row_label_position)
    table_height = rows * metrics.cell_height + metrics.platform_height
    centered_top = (SEAT_PAPER_HEIGHT - table_height) / 2
    min_top = SEAT_EDGE_PADDING + metrics.title_offset
    return max(min_top, centered_top)


def default_seat_layout(
    students: list[Student],
    rows: int = 5,
    columns: int = 5,
    row_label_position: str = SEAT_DEFAULT_ROW_LABEL_POSITION,
    source_excel_path: Path | str | None = None,
) -> SeatLayout:
    rows = clamp_dimension(rows)
    columns = clamp_dimension(columns)
    if row_label_position not in {"left", "right", "none"}:
        row_label_position = SEAT_DEFAULT_ROW_LABEL_POSITION
    scale_percent = clamp_scale_percent(SEAT_DEFAULT_SCALE_PERCENT, rows, columns, row_label_position)
    metrics = seat_metrics_for_values(rows, columns, scale_percent, row_label_position)
    left = default_left_for_columns(columns, scale_percent, row_label_position, rows)
    top = default_top_for_rows(rows, scale_percent, columns, row_label_position)
    seats: list[Seat] = []
    for row in range(rows):
        for column in range(columns):
            seats.append(
                Seat(
                    name=student_name_for_grid_cell(row, column, students, rows, columns),
                    x=left + column * metrics.cell_width,
                    y=top + row * metrics.cell_height,
                )
            )
    return SeatLayout(
        version=3,
        rows=rows,
        columns=columns,
        left=left,
        top=top,
        scale_percent=metrics.scale_percent,
        row_label_position=row_label_position,
        seats=seats,
        source_excel_path=str(source_excel_path or ""),
        student_names=[student.name for student in students],
    )


def reset_layout_for_students(
    students: list[Student],
    preferred_columns: int = 5,
    row_label_position: str = SEAT_DEFAULT_ROW_LABEL_POSITION,
    source_excel_path: Path | str | None = None,
) -> SeatLayout:
    rows, columns = default_dimensions(len(students), preferred_columns)
    return default_seat_layout(students, rows, columns, row_label_position, source_excel_path)


def layout_to_dict(layout: SeatLayout) -> dict:
    return {
        "version": layout.version,
        "source_excel_path": layout.source_excel_path,
        "student_names": list(layout.student_names),
        "rows": layout.rows,
        "columns": layout.columns,
        "left": round(float(layout.left), 2),
        "top": round(float(layout.top), 2),
        "scale_percent": round(float(seat_metrics(layout).scale_percent), 4),
        "row_label_position": layout.row_label_position,
        "title_text": layout.title_text,
        "seats": [
            {
                "name": seat.name,
                "x": round(float(seat.x), 2),
                "y": round(float(seat.y), 2),
            }
            for seat in layout.seats
        ],
    }


def layout_from_dict(data: dict | None) -> SeatLayout:
    data = data or {}
    row_label_position = data.get("row_label_position", SEAT_DEFAULT_ROW_LABEL_POSITION)
    if row_label_position not in {"left", "right", "none"}:
        row_label_position = SEAT_DEFAULT_ROW_LABEL_POSITION
    rows = clamp_dimension(data.get("rows", 5))
    columns = clamp_dimension(data.get("columns", 5))
    scale_percent = clamp_scale_percent(data.get("scale_percent"), rows, columns, row_label_position)
    seats: list[Seat] = []
    for seat in data.get("seats", []) or []:
        if not isinstance(seat, dict):
            continue
        try:
            x = float(seat.get("x", SEAT_DEFAULT_LEFT))
            y = float(seat.get("y", SEAT_DEFAULT_TOP))
        except (TypeError, ValueError):
            x, y = SEAT_DEFAULT_LEFT, SEAT_DEFAULT_TOP
        seats.append(Seat(name=str(seat.get("name", "")), x=x, y=y))
    return align_regular_grid_seats(SeatLayout(
        version=max(int(data.get("version", 3) or 3), 3),
        source_excel_path=str(data.get("source_excel_path") or ""),
        student_names=[str(name) for name in data.get("student_names", []) or []],
        rows=rows,
        columns=columns,
        left=float(data.get("left", SEAT_DEFAULT_LEFT) or SEAT_DEFAULT_LEFT),
        top=float(data.get("top", SEAT_DEFAULT_TOP) or SEAT_DEFAULT_TOP),
        scale_percent=scale_percent,
        row_label_position=row_label_position,
        title_text=str(data.get("title_text") or "班级座位表"),
        seats=seats,
    ))


def seat_table_rect(layout: SeatLayout) -> tuple[float, float, float, float]:
    metrics = seat_metrics(layout)
    left = layout.left
    right = layout.left + layout.columns * metrics.cell_width
    top = layout.top - metrics.title_offset
    bottom = layout.top + layout.rows * metrics.cell_height + metrics.platform_height
    if layout.row_label_position == "left":
        left -= metrics.row_label_space
    elif layout.row_label_position == "right":
        right += metrics.row_label_space
    for seat in layout.seats:
        left = min(left, seat.x)
        right = max(right, seat.x + metrics.cell_width)
        top = min(top, seat.y)
        bottom = max(bottom, seat.y + metrics.cell_height)
    return (
        left - SEAT_PAPER_CONTENT_MARGIN_X,
        top - SEAT_PAPER_CONTENT_MARGIN_Y,
        right + SEAT_PAPER_CONTENT_MARGIN_X,
        bottom + SEAT_PAPER_CONTENT_MARGIN_Y,
    )


def paper_rect(layout: SeatLayout) -> tuple[float, float, float, float]:
    return 0.0, 0.0, SEAT_PAPER_WIDTH, SEAT_PAPER_HEIGHT


def dynamic_paper_rect(layout: SeatLayout) -> tuple[float, float, float, float]:
    metrics = seat_metrics(layout)
    left = SEAT_DEFAULT_LEFT
    right = SEAT_DEFAULT_LEFT + layout.columns * metrics.cell_width
    top = SEAT_DEFAULT_TOP - metrics.title_offset
    bottom = SEAT_DEFAULT_TOP + layout.rows * metrics.cell_height + metrics.platform_height
    if layout.row_label_position == "left":
        left -= metrics.row_label_space
    elif layout.row_label_position == "right":
        right += metrics.row_label_space

    content_left = left - SEAT_PAPER_CONTENT_MARGIN_X
    content_top = top - SEAT_PAPER_CONTENT_MARGIN_Y
    content_right = right + SEAT_PAPER_CONTENT_MARGIN_X
    content_bottom = bottom + SEAT_PAPER_CONTENT_MARGIN_Y
    content_width = content_right - content_left
    content_height = content_bottom - content_top
    width = max(SEAT_PAPER_MIN_WIDTH, content_width)
    height = width / SEAT_PAPER_ASPECT
    if height < content_height:
        height = content_height
        width = height * SEAT_PAPER_ASPECT
    center_x = (content_left + content_right) / 2
    center_y = (content_top + content_bottom) / 2
    return center_x - width / 2, center_y - height / 2, center_x + width / 2, center_y + height / 2
