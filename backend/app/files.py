from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlmodel import Session

from .config import get_settings
from .models import FileRecord


def safe_suffix(filename: str, allowed: set[str] | None = None) -> str:
    suffix = Path(filename).suffix.lower()
    if allowed is not None and suffix not in allowed:
        raise ValueError(f"不支持的文件类型：{suffix or '无扩展名'}")
    return suffix


def relative_path(path: Path) -> str:
    settings = get_settings()
    return str(path.resolve().relative_to(settings.data_dir.resolve()))


def absolute_path(stored_path: str) -> Path:
    settings = get_settings()
    return (settings.data_dir / stored_path).resolve()


def create_file_record(
    session: Session,
    path: Path,
    filename: str,
    kind: str,
    project_id: int | None,
    content_type: str = "application/octet-stream",
) -> FileRecord:
    record = FileRecord(
        id=uuid.uuid4().hex,
        project_id=project_id,
        kind=kind,
        path=relative_path(path),
        filename=filename,
        content_type=content_type or "application/octet-stream",
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def save_upload_file(
    session: Session,
    upload: UploadFile,
    project_id: int,
    kind: str,
    allowed_suffixes: set[str],
) -> FileRecord:
    settings = get_settings()
    suffix = safe_suffix(upload.filename or "", allowed_suffixes)
    target_dir = settings.uploads_dir / str(project_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{suffix}"
    target = target_dir / filename
    with target.open("wb") as output:
        shutil.copyfileobj(upload.file, output)
    return create_file_record(
        session,
        target,
        upload.filename or filename,
        kind=kind,
        project_id=project_id,
        content_type=upload.content_type or "application/octet-stream",
    )


def register_export(session: Session, path: Path, filename: str, project_id: int, content_type: str) -> FileRecord:
    return create_file_record(session, path, filename, "export", project_id, content_type)
