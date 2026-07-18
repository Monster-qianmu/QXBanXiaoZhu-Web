from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Student:
    index: int
    name: str
    hometown: str
    photo_path: Path | None = None
    photo_match_status: str = "unmatched"
    original_index: int | None = None
    class_name: str = ""
    dorm_key: str = ""


@dataclass
class DormRoom:
    number: str
    beds: list[str | None]


@dataclass
class Seat:
    name: str
    x: float
    y: float


@dataclass
class SeatLayout:
    rows: int = 5
    columns: int = 5
    left: float = 120.0
    top: float = 120.0
    scale_percent: float = 60.0
    row_label_position: str = "none"
    title_text: str = "班级座位表"
    seats: list[Seat] = field(default_factory=list)
    source_excel_path: str = ""
    student_names: list[str] = field(default_factory=list)
    version: int = 3


@dataclass
class StickerExportOptions:
    sticker_kind: str = "door"
    student_ids: list[int] | None = None
