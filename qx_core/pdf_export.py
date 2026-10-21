from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageOps
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from .constants import (
    BED_CABINET_STICKER_HEIGHT_MM,
    BED_CABINET_STICKER_WIDTH_MM,
    PHOTO_BACKGROUND_COLOR,
    SEAT_CELL_HEIGHT,
    SEAT_CELL_WIDTH,
    SEAT_PLATFORM_HEIGHT,
)
from .models import SeatLayout, Student
from .seats import layout_from_dict, paper_rect
from .seats import seat_metrics
from .stickers import Rect, sticker_page_rects

FONT_NAME = "STSong-Light"


def ensure_font() -> None:
    if FONT_NAME not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(UnicodeCIDFont(FONT_NAME))


def fit_font_size(text: str, max_width: float, start: float, minimum: float) -> float:
    ensure_font()
    size = start
    while size > minimum:
        if pdfmetrics.stringWidth(text, FONT_NAME, size) <= max_width:
            return size
        size -= 0.5
    return minimum


def draw_centered_text(c: canvas.Canvas, text: str, x: float, y: float, width: float, height: float, size: float) -> None:
    ensure_font()
    c.setFont(FONT_NAME, size)
    c.drawCentredString(x + width / 2, y + (height - size) / 2, text)


def export_seat_pdf(path: Path, layout_data: dict | SeatLayout) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    layout = layout_data if isinstance(layout_data, SeatLayout) else layout_from_dict(layout_data)
    ensure_font()
    page_width, page_height = landscape(A4)
    c = canvas.Canvas(str(path), pagesize=(page_width, page_height))
    c.setFillColor(colors.white)
    c.rect(0, 0, page_width, page_height, stroke=0, fill=1)
    metrics = seat_metrics(layout)
    font_scale = max(0.72, min(metrics.scale_factor, 2.2))

    source_left, source_top, source_right, source_bottom = paper_rect(layout)
    source_width = source_right - source_left
    source_height = source_bottom - source_top

    def tx(x: float) -> float:
        return (x - source_left) / source_width * page_width

    def ty(y: float) -> float:
        return page_height - ((y - source_top) / source_height * page_height)

    def rect_top_left(x: float, y: float, width: float, height: float) -> tuple[float, float, float, float]:
        left = tx(x)
        top = ty(y)
        right = tx(x + width)
        bottom = ty(y + height)
        return left, bottom, right - left, top - bottom

    title_width = tx(layout.left + layout.columns * metrics.cell_width) - tx(layout.left)
    title_size = fit_font_size(layout.title_text, title_width, 24 * font_scale, 14)
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont(FONT_NAME, title_size)
    title_x = tx(layout.left + layout.columns * metrics.cell_width / 2)
    title_y = ty(layout.top - metrics.title_offset * 0.72)
    c.drawCentredString(title_x, title_y, layout.title_text)

    c.setStrokeColor(colors.HexColor("#20242a"))
    c.setLineWidth(0.7)
    c.setFillColor(colors.white)
    for column in range(layout.columns):
        text = f"第 {column + 1} 组"
        label_width = tx(layout.left + (column + 1) * metrics.cell_width) - tx(layout.left + column * metrics.cell_width)
        label_size = fit_font_size(text, label_width, 13 * font_scale, 8)
        c.setFillColor(colors.HexColor("#111827"))
        c.setFont(FONT_NAME, label_size)
        c.drawCentredString(tx(layout.left + column * metrics.cell_width + metrics.cell_width / 2), ty(layout.top - 22 * metrics.scale_factor), text)

    if layout.row_label_position != "none":
        for row in range(layout.rows):
            text = f"第 {layout.rows - row} 排"
            x = layout.left + layout.columns * metrics.cell_width + 42 * metrics.scale_factor if layout.row_label_position == "right" else layout.left - 42 * metrics.scale_factor
            c.setFillColor(colors.HexColor("#111827"))
            c.setFont(FONT_NAME, 11 * font_scale)
            c.drawCentredString(tx(x), ty(layout.top + row * metrics.cell_height + metrics.cell_height * 0.62), text)

    for seat in layout.seats:
        x, y, width, height = rect_top_left(seat.x, seat.y, metrics.cell_width, metrics.cell_height)
        c.setFillColor(colors.HexColor("#ffffff"))
        c.setStrokeColor(colors.HexColor("#111827"))
        c.setLineWidth(0.7)
        c.rect(x, y, width, height, stroke=1, fill=1)
        if seat.name.strip():
            size = fit_font_size(seat.name, width * 0.82, 13 * font_scale, 7)
            c.setFillColor(colors.HexColor("#111827"))
            c.setFont(FONT_NAME, size)
            c.drawCentredString(x + width / 2, y + height / 2 - size / 3, seat.name)

    platform_x, platform_y, platform_w, platform_h = rect_top_left(
        layout.left,
        layout.top + layout.rows * metrics.cell_height,
        layout.columns * metrics.cell_width,
        metrics.platform_height,
    )
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor("#111827"))
    c.rect(platform_x, platform_y, platform_w, platform_h, stroke=1, fill=1)
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont(FONT_NAME, 20 * font_scale)
    c.drawCentredString(platform_x + platform_w / 2, platform_y + platform_h / 2 - 7 * font_scale, "讲台")

    c.save()
    if not path.exists() or path.stat().st_size == 0:
        raise RuntimeError("PDF 文件未成功生成")


def top_left_to_pdf(rect: Rect, page_height: float) -> tuple[float, float, float, float]:
    return rect.x, page_height - rect.y - rect.height, rect.width, rect.height


def draw_text_line(c: canvas.Canvas, prefix: str, value: str, x: float, y: float, width: float, gap: float) -> None:
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.7)
    c.line(x, y, x + width, y)
    text = f"{prefix}{value}"
    size = fit_font_size(text, width, gap * 0.56, gap * 0.32)
    c.setFillColor(colors.black)
    c.setFont(FONT_NAME, size)
    c.drawString(x + 3, y + gap * 0.18, text)


def prepared_image_reader(image_path: Path, target_width: int, target_height: int, crop: bool):
    image = Image.open(image_path).convert("RGB")
    if crop:
        output = ImageOps.fit(image, (target_width, target_height), method=Image.Resampling.LANCZOS)
    else:
        output = Image.new("RGB", (target_width, target_height), PHOTO_BACKGROUND_COLOR)
        image.thumbnail((target_width, target_height), Image.Resampling.LANCZOS)
        output.paste(image, ((target_width - image.width) // 2, (target_height - image.height) // 2))
    buffer = io.BytesIO()
    output.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def draw_sticker(c: canvas.Canvas, page_height: float, rect: Rect, student: Student, include_class: bool, crop_photo: bool) -> None:
    x, y, width, height = top_left_to_pdf(rect, page_height)
    c.setStrokeColor(colors.HexColor("#c8ced6"))
    c.setFillColor(colors.white)
    c.setLineWidth(0.7)
    c.rect(x, y, width, height, stroke=1, fill=1)

    photo_top_ratio = 0.10 if not include_class else 0.12
    photo_height_ratio = 0.46 if not include_class else 0.52
    photo_height = height * photo_height_ratio
    photo_width = min(width * 0.60, photo_height * 160 / 210)
    photo_x = x + (width - photo_width) / 2
    photo_y = y + height - (height * photo_top_ratio) - photo_height
    c.setStrokeColor(colors.HexColor("#8ea8c8"))
    c.setFillColor(colors.HexColor("#e8eef6"))
    c.rect(photo_x, photo_y, photo_width, photo_height, stroke=1, fill=1)
    if student.photo_path and student.photo_path.exists():
        try:
            image_buffer = prepared_image_reader(student.photo_path, int(photo_width * 2), int(photo_height * 2), crop_photo)
            c.drawImage(ImageReader(image_buffer), photo_x, photo_y, photo_width, photo_height, preserveAspectRatio=False, mask="auto")
        except Exception:
            pass
    else:
        c.setFillColor(colors.HexColor("#536579"))
        c.setFont(FONT_NAME, fit_font_size("无照片", photo_width * 0.8, height * 0.045, 8))
        c.drawCentredString(photo_x + photo_width / 2, photo_y + photo_height / 2 - 4, "无照片")

    line_left = x + width * 0.14
    line_width = width * 0.72
    line_gap = height * 0.058
    lines = [("姓名：", student.name), ("籍贯：", student.hometown)]
    if include_class:
        lines.append(("班级：", student.class_name))
    lines.append(("送生区：", student.source_area))
    first_y = y + height * 0.28
    spacing = height * (0.071 if include_class else 0.10)
    for index, (label, value) in enumerate(lines):
        draw_text_line(c, label, value, line_left, first_y - index * spacing, line_width, line_gap)


def export_stickers_pdf(path: Path, students: list[Student], sticker_kind: str = "door") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ensure_font()
    page_width, page_height = A4
    c = canvas.Canvas(str(path), pagesize=A4)
    for page_start in range(0, len(students), 4):
        if page_start:
            c.showPage()
        c.setFillColor(colors.white)
        c.rect(0, 0, page_width, page_height, stroke=0, fill=1)
        page_students = students[page_start : page_start + 4]
        rects = sticker_page_rects(sticker_kind, page_width, page_height)
        for index, student in enumerate(page_students):
            draw_sticker(c, page_height, rects[index], student, include_class=sticker_kind != "bed_cabinet", crop_photo=sticker_kind != "bed_cabinet")
        if sticker_kind == "bed_cabinet":
            c.setStrokeColor(colors.black)
            c.setDash(4, 3)
            x_positions = sorted({rect.x for rect in rects} | {rect.right for rect in rects})
            y_positions = sorted({rect.y for rect in rects} | {rect.bottom for rect in rects})
            for x_pos in x_positions:
                c.line(x_pos, 0, x_pos, page_height)
            for y_pos in y_positions:
                c.line(0, page_height - y_pos, page_width, page_height - y_pos)
            c.setDash()
            c.setFillColor(colors.HexColor("#4f7fd7"))
            c.setFont(FONT_NAME, 8)
            for rect in rects:
                c.drawCentredString(rect.x + rect.width / 2, page_height - rect.bottom - 10, "虚线为辅助裁剪线")
    c.save()
    if not path.exists() or path.stat().st_size == 0:
        raise RuntimeError("PDF 文件未成功生成")
