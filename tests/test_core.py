from pathlib import Path

from openpyxl import Workbook
from PIL import Image
import pytest

from qx_core import (
    Student,
    attach_photos,
    export_dorm_roster_to_excel,
    export_students_to_excel,
    layout_from_dict,
    layout_to_dict,
    load_dorm_rooms_from_excel,
    load_students_from_excel,
    reset_layout_for_students,
)
from qx_core.pdf_export import export_seat_pdf, export_stickers_pdf
from qx_core.constants import PHOTO_BACKGROUND_COLOR
from qx_core.photos import (
    copy_managed_photo,
    create_blue_background_photo,
    photo_background_available,
    photo_sequence_number,
    photo_sequence_summary,
    prewarm_photo_background_session,
)
from qx_core.seats import paper_rect, seat_metrics


def write_students_excel(path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["序号", "姓名", "籍贯", "班级"])
    sheet.append([1, "张三", "广州", "一班"])
    sheet.append([2, "李四", "深圳", "一班"])
    workbook.save(path)


def test_students_excel_round_trip(tmp_path: Path) -> None:
    source = tmp_path / "students.xlsx"
    write_students_excel(source)
    students = load_students_from_excel(source)
    assert [student.name for student in students] == ["张三", "李四"]
    target = tmp_path / "export.xlsx"
    export_students_to_excel(target, students)
    assert target.exists()
    assert load_students_from_excel(target)[1].class_name == "一班"


def test_backend_dockerfile_includes_builtin_resources() -> None:
    dockerfile = Path(__file__).parents[1] / "backend" / "Dockerfile"
    assert "COPY resources /app/resources" in dockerfile.read_text()


def test_dorm_roster_match_and_export(tmp_path: Path) -> None:
    students = [
        Student(index=1, name="张三", hometown="广州", class_name="一班", dorm_key="1"),
        Student(index=2, name="李四", hometown="深圳", class_name="一班", dorm_key="2"),
    ]
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["宿舍号", "床号", "姓名", "籍贯"])
    sheet.append(["501", "01", "张三", "广州"])
    sheet.append(["", "02", "李四", "深圳"])
    source = tmp_path / "dorms.xlsx"
    workbook.save(source)
    rooms, matched_count = load_dorm_rooms_from_excel(source, students)
    assert matched_count == 2
    assert rooms[0].beds == ["1", "2"]
    target = tmp_path / "roster.xlsx"
    export_dorm_roster_to_excel(target, rooms, {student.dorm_key: student for student in students})
    assert target.exists()


def test_photo_matching(tmp_path: Path) -> None:
    photo_dir = tmp_path / "photos"
    photo_dir.mkdir()
    Image.new("RGB", (20, 20), "white").save(photo_dir / "03_张三.jpg")
    students = [Student(index=1, name="张三", hometown="广州")]
    attach_photos(students, photo_dir)
    assert students[0].photo_match_status == "strict"
    assert students[0].photo_path and students[0].photo_path.name == "03_张三.jpg"


def test_managed_photo_is_normalized_for_dorm_stickers(tmp_path: Path) -> None:
    source = tmp_path / "wide.jpg"
    Image.new("RGB", (600, 300), "red").save(source)

    target = copy_managed_photo(source, tmp_path / "managed", 7, source.name)

    assert target.suffix == ".png"
    with Image.open(target) as image:
        assert image.size == (160, 210)
        assert image.format == "PNG"


def test_managed_photo_applies_exif_orientation(tmp_path: Path) -> None:
    source = tmp_path / "phone.jpg"
    image = Image.new("RGB", (80, 40), "white")
    for x in range(80):
        for y in range(40):
            image.putpixel((x, y), (240, 0, 0) if x < 40 else (0, 0, 240))
    exif = Image.Exif()
    exif[274] = 6
    image.save(source, exif=exif)

    target = copy_managed_photo(source, tmp_path / "managed", 8, source.name)

    with Image.open(target) as output:
        top = output.getpixel((80, 20))
        bottom = output.getpixel((80, 190))
    assert top[0] > 180 and top[2] < 80
    assert bottom[2] > 180 and bottom[0] < 80


def test_blue_background_photo_composes_transparent_cutout(tmp_path: Path) -> None:
    source = tmp_path / "portrait.jpg"
    Image.new("RGB", (20, 20), "white").save(source)

    def fake_remove(_image_data: bytes) -> bytes:
        from io import BytesIO

        cutout = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
        for x in range(6, 14):
            for y in range(4, 18):
                cutout.putpixel((x, y), (240, 0, 0, 255))
        buffer = BytesIO()
        cutout.save(buffer, format="PNG")
        return buffer.getvalue()

    target = create_blue_background_photo(source, tmp_path / "blue", source.name, remover=fake_remove)

    assert target.name.startswith("portrait-blue-")
    with Image.open(target) as output:
        assert output.size == (20, 20)
        assert output.format == "PNG"
        assert output.getpixel((0, 0)) == tuple(int(PHOTO_BACKGROUND_COLOR[index : index + 2], 16) for index in (1, 3, 5))
        assert output.getpixel((10, 10))[0] > 200


def test_photo_background_availability_checks_both_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    installed = {"rembg", "onnxruntime"}
    monkeypatch.setattr("qx_core.photos.find_spec", lambda name: object() if name in installed else None)
    assert photo_background_available() is True

    installed.remove("onnxruntime")
    assert photo_background_available() is False


def test_photo_background_prewarm_runs_a_memory_only_probe() -> None:
    received_sizes = []

    def fake_remove(image_data: bytes) -> bytes:
        from io import BytesIO

        with Image.open(BytesIO(image_data)) as image:
            received_sizes.append(image.size)
        return image_data

    prewarm_photo_background_session(remover=fake_remove)

    assert received_sizes == [(32, 32)]


def test_photo_sequence_summary_detects_missing_prefixes() -> None:
    assert photo_sequence_number("06_.jpg") == 6
    numbers, missing = photo_sequence_summary([
        "01_危志康.png",
        "03_李炳昌.png",
        "05_刘翰源.png",
        "06_.jpg",
        "19_黄辰希.jpg",
        "无序号照片.jpg",
    ])

    assert numbers == [1, 3, 5, 6, 19]
    assert missing == [2, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]


def test_pdf_smoke(tmp_path: Path) -> None:
    students = [Student(index=1, name="张三", hometown="广州", class_name="一班")]
    layout = reset_layout_for_students(students)
    assert (layout.rows, layout.columns) == (5, 5)
    assert layout.seats[(layout.rows - 1) * layout.columns].name == "张三"
    assert paper_rect(layout) == (0.0, 0.0, 1120.0, 792.0)
    layout_data = layout_to_dict(layout)
    assert layout_data["version"] == 3
    assert layout_data["scale_percent"] == 60
    assert layout_data["row_label_position"] == "none"
    metrics = seat_metrics(layout)
    assert layout.left == pytest.approx((1120.0 - layout.columns * metrics.cell_width) / 2)
    seat_pdf = tmp_path / "seats.pdf"
    export_seat_pdf(seat_pdf, layout_data)
    assert seat_pdf.stat().st_size > 0
    sticker_pdf = tmp_path / "stickers.pdf"
    export_stickers_pdf(sticker_pdf, students, "door")
    assert sticker_pdf.stat().st_size > 0


def test_legacy_seat_grid_is_aligned_to_current_metrics() -> None:
    seats = []
    for row in range(5):
        for column in range(5):
            seats.append({"name": "", "x": 350 + column * 84, "y": 246 + row * 48})
    layout = layout_from_dict(
        {
            "version": 3,
            "rows": 5,
            "columns": 5,
            "left": 350,
            "top": 246,
            "scale_percent": 41.35338345864661,
            "row_label_position": "left",
            "title_text": "班级座位表",
            "seats": seats,
        }
    )
    metrics = seat_metrics(layout)
    assert layout.seats[1].x - layout.seats[0].x == pytest.approx(metrics.cell_width)
    assert layout.seats[5].y - layout.seats[0].y == pytest.approx(metrics.cell_height)
