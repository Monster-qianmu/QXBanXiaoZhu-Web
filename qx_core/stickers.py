from __future__ import annotations

from dataclasses import dataclass

from .constants import (
    BED_CABINET_STICKER_HEIGHT_MM,
    BED_CABINET_STICKER_WIDTH_MM,
    DOOR_STICKER_HEIGHT_MM,
    DOOR_STICKER_WIDTH_MM,
    STICKER_A4_HEIGHT_MM,
    STICKER_A4_WIDTH_MM,
    STICKER_GAP_X_MM,
    STICKER_GAP_Y_MM,
)


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height


def sticker_size_mm(sticker_kind: str) -> tuple[float, float]:
    if sticker_kind == "bed_cabinet":
        return BED_CABINET_STICKER_WIDTH_MM, BED_CABINET_STICKER_HEIGHT_MM
    return DOOR_STICKER_WIDTH_MM, DOOR_STICKER_HEIGHT_MM


def sticker_cell_rect(
    page_width: float,
    page_height: float,
    index: int,
    sticker_width_mm: float,
    sticker_height_mm: float,
    equal_gaps: bool = False,
    quarter_page: bool = False,
) -> Rect:
    if quarter_page:
        card_w = page_width / 2
        card_h = page_height / 2
        column = index % 2
        row = index // 2
        return Rect(column * card_w, row * card_h, card_w, card_h)

    scale_x = page_width / STICKER_A4_WIDTH_MM
    scale_y = page_height / STICKER_A4_HEIGHT_MM
    card_w = sticker_width_mm * scale_x
    card_h = sticker_height_mm * scale_y
    if equal_gaps:
        gap_x = (page_width - card_w * 2) / 3
        gap_y = (page_height - card_h * 2) / 3
        outer_x = gap_x
        outer_y = gap_y
    else:
        gap_x = STICKER_GAP_X_MM * scale_x
        gap_y = STICKER_GAP_Y_MM * scale_y
        outer_x = (page_width - card_w * 2 - gap_x) / 2
        outer_y = (page_height - card_h * 2 - gap_y) / 2
    column = index % 2
    row = index // 2
    return Rect(outer_x + column * (card_w + gap_x), outer_y + row * (card_h + gap_y), card_w, card_h)


def sticker_page_rects(sticker_kind: str, page_width: float, page_height: float) -> list[Rect]:
    width_mm, height_mm = sticker_size_mm(sticker_kind)
    return [
        sticker_cell_rect(
            page_width,
            page_height,
            index,
            width_mm,
            height_mm,
            equal_gaps=sticker_kind == "bed_cabinet",
            quarter_page=sticker_kind == "door",
        )
        for index in range(4)
    ]
