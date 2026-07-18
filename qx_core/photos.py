from __future__ import annotations

import io
import re
import threading
import uuid
from collections.abc import Callable
from importlib.util import find_spec
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from .constants import DORM_TAG_PHOTO_HEIGHT_PX, DORM_TAG_PHOTO_WIDTH_PX, PHOTO_BACKGROUND_COLOR
from .models import Student

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}
MANAGED_PHOTO_CONTENT_TYPE = "image/png"
BLUE_BACKGROUND_CONTENT_TYPE = "image/png"
PHOTO_BACKGROUND_DEPENDENCY_MESSAGE = "蓝底抠图依赖未安装，请在后端安装 rembg 和 onnxruntime 后重试。"

_photo_background_session_lock = threading.Lock()
_photo_background_session_instance = None


def normalize_name(value: str) -> str:
    normalized = re.sub(r"[\s_\-0-9（）()\[\]【】.·、,，]+", "", value).lower()
    return re.sub(r"(照片|相片|头像|证件照|学生|姓名|班级)", "", normalized)


def photo_sequence_number(filename: str) -> int | None:
    match = re.match(r"^\s*(\d+)", Path(filename).stem)
    if not match:
        return None
    return int(match.group(1))


def photo_sequence_summary(filenames: list[str]) -> tuple[list[int], list[int]]:
    numbers = sorted({number for filename in filenames if (number := photo_sequence_number(filename)) is not None})
    if len(numbers) < 2:
        return numbers, []
    present = set(numbers)
    missing = [number for number in range(numbers[0], numbers[-1] + 1) if number not in present]
    return numbers, missing


def find_photo_for_name(name: str, photos_dir: Path) -> tuple[Path | None, str]:
    if not photos_dir.exists():
        return None, "unmatched"

    image_files = [
        path
        for path in photos_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]

    exact_name = name.strip()
    for image_file in image_files:
        if image_file.stem.strip() == exact_name:
            return image_file, "strict"

    student_key = normalize_name(name)
    for image_file in image_files:
        if student_key and normalize_name(image_file.stem) == student_key:
            return image_file, "strict"

    for image_file in image_files:
        if student_key and student_key in normalize_name(image_file.stem):
            return image_file, "fuzzy"
    return None, "unmatched"


def attach_photos(students: list[Student], photos_dir: Path) -> None:
    if not photos_dir.exists():
        return
    for student in students:
        student.photo_path, student.photo_match_status = find_photo_for_name(student.name, photos_dir)


def validate_image_filename(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in IMAGE_EXTENSIONS:
        raise ValueError("只支持 PNG、JPG、JPEG、BMP、WEBP 图片。")
    return suffix


def managed_photo_name(student_id: int, original_filename: str) -> str:
    validate_image_filename(original_filename)
    return f"student-{student_id}-{uuid.uuid4().hex[:10]}.png"


def blue_background_photo_name(original_filename: str) -> str:
    validate_image_filename(original_filename)
    stem = Path(original_filename).stem or "photo"
    return f"{stem}-blue-{uuid.uuid4().hex[:10]}.png"


def copy_managed_photo(source: Path, target_dir: Path, student_id: int, original_filename: str) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / managed_photo_name(student_id, original_filename)
    try:
        with Image.open(source) as raw_image:
            image = ImageOps.exif_transpose(raw_image).convert("RGBA")
    except (OSError, UnidentifiedImageError) as exc:
        raise ValueError("照片文件无法读取，请检查图片是否损坏。") from exc

    background = Image.new("RGBA", image.size, PHOTO_BACKGROUND_COLOR)
    background.alpha_composite(image)
    output = ImageOps.fit(
        background.convert("RGB"),
        (DORM_TAG_PHOTO_WIDTH_PX, DORM_TAG_PHOTO_HEIGHT_PX),
        method=Image.Resampling.LANCZOS,
    )
    output.save(target, format="PNG")
    return target


def photo_background_available() -> bool:
    return find_spec("rembg") is not None and find_spec("onnxruntime") is not None


def _photo_background_session():
    global _photo_background_session_instance
    with _photo_background_session_lock:
        if _photo_background_session_instance is None:
            from rembg import new_session

            _photo_background_session_instance = new_session("u2netp")
        return _photo_background_session_instance


def _remove_with_lightweight_model(image_data: bytes) -> bytes:
    try:
        from rembg import remove
    except ImportError as exc:
        raise RuntimeError(PHOTO_BACKGROUND_DEPENDENCY_MESSAGE) from exc

    return remove(image_data, session=_photo_background_session())


def prewarm_photo_background_session(remover: Callable[[bytes], bytes] | None = None) -> None:
    if remover is None:
        remover = _remove_with_lightweight_model
    probe = Image.new("RGB", (32, 32), "white")
    buffer = io.BytesIO()
    probe.save(buffer, format="PNG")
    try:
        remover(buffer.getvalue())
    except Exception as exc:
        raise RuntimeError(f"蓝底引擎预热失败：{exc}") from exc



def image_bytes_with_applied_orientation(source: Path) -> bytes:
    try:
        with Image.open(source) as raw_image:
            image = ImageOps.exif_transpose(raw_image).convert("RGBA")
    except (OSError, UnidentifiedImageError) as exc:
        raise ValueError("照片文件无法读取，请检查图片是否损坏。") from exc
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def compose_blue_background(removed_image_data: bytes) -> tuple[Image.Image, tuple[int, int, int, int]]:
    try:
        foreground = Image.open(io.BytesIO(removed_image_data)).convert("RGBA")
    except (OSError, UnidentifiedImageError) as exc:
        raise ValueError("蓝底照片生成后无法读取。") from exc
    subject_box = foreground.getchannel("A").getbbox()
    if not subject_box:
        raise ValueError("未检测到清晰的人物或主体区域。")
    blue_background = Image.new("RGBA", foreground.size, PHOTO_BACKGROUND_COLOR)
    blue_background.paste(foreground, (0, 0), foreground)
    return blue_background.convert("RGB"), subject_box


def create_blue_background_photo(
    source: Path,
    target_dir: Path,
    original_filename: str,
    remover: Callable[[bytes], bytes] | None = None,
) -> Path:
    validate_image_filename(original_filename)
    if remover is None:
        remover = _remove_with_lightweight_model

    source_data = image_bytes_with_applied_orientation(source)
    try:
        removed = remover(source_data)
    except Exception as exc:
        raise RuntimeError(f"人物/主体区域检测失败：{exc}") from exc

    output, _subject_box = compose_blue_background(removed)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / blue_background_photo_name(original_filename)
    output.save(target, format="PNG")
    return target
