from __future__ import annotations

import threading
import uuid
from datetime import datetime, timedelta

from sqlmodel import Session, select

from qx_core.photos import (
    BLUE_BACKGROUND_CONTENT_TYPE,
    create_blue_background_photo,
    photo_background_available,
    prewarm_photo_background_session,
)

from .config import get_settings
from .db import get_engine
from .files import absolute_path, create_file_record
from .models import ActivityRecord, FileRecord, PhotoBackgroundJobRecord, ProjectRecord, StudentRecord

ACTIVE_PHOTO_BACKGROUND_JOB_STATUSES = {"queued", "running"}
TERMINAL_PHOTO_BACKGROUND_JOB_STATUSES = {"succeeded", "failed"}
PHOTO_BACKGROUND_RESULT_TTL = timedelta(minutes=10)
PHOTO_BACKGROUND_CLEANUP_INTERVAL_SECONDS = 30

_worker_lock = threading.Lock()
_worker_stop = threading.Event()
_worker_wake = threading.Event()
_worker_thread: threading.Thread | None = None
_cleanup_thread: threading.Thread | None = None
_warmup_lock = threading.Lock()
_warmup_done = threading.Event()
_warmup_thread: threading.Thread | None = None
_warmup_status = "disabled"
_warmup_error = ""


def queue_ahead_count(session: Session, job_id: str) -> int:
    jobs = list(
        session.exec(
            select(PhotoBackgroundJobRecord)
            .where(PhotoBackgroundJobRecord.status.in_(ACTIVE_PHOTO_BACKGROUND_JOB_STATUSES))
            .order_by(PhotoBackgroundJobRecord.created_at, PhotoBackgroundJobRecord.id)
        )
    )
    for index, job in enumerate(jobs):
        if job.id == job_id:
            return index
    return 0


def notify_photo_background_worker() -> None:
    _worker_wake.set()


def photo_background_warmup_state() -> dict[str, str]:
    with _warmup_lock:
        return {"status": _warmup_status, "error": _warmup_error}


def _start_photo_background_warmup() -> None:
    global _warmup_status, _warmup_error, _warmup_thread
    settings = get_settings()
    with _warmup_lock:
        _warmup_error = ""
        if not settings.photo_background_enabled or not settings.photo_background_prewarm_enabled or not photo_background_available():
            _warmup_status = "disabled"
            _warmup_done.set()
            return
        _warmup_status = "warming"
        _warmup_done.clear()
        _warmup_thread = threading.Thread(target=_warmup_photo_background, name="qxban-photo-warmup", daemon=True)
        _warmup_thread.start()


def _warmup_photo_background() -> None:
    global _warmup_status, _warmup_error
    try:
        prewarm_photo_background_session()
    except Exception as exc:
        with _warmup_lock:
            _warmup_status = "failed"
            _warmup_error = str(exc)
    else:
        with _warmup_lock:
            _warmup_status = "ready"
            _warmup_error = ""
    finally:
        _warmup_done.set()
        _worker_wake.set()


def recover_photo_background_jobs() -> None:
    with Session(get_engine()) as session:
        interrupted_jobs = list(
            session.exec(select(PhotoBackgroundJobRecord).where(PhotoBackgroundJobRecord.status == "running"))
        )
        for job in interrupted_jobs:
            job.status = "queued"
            job.started_at = None
            job.error_message = ""
            session.add(job)
        if interrupted_jobs:
            session.commit()


def cleanup_expired_photo_background_jobs(now: datetime | None = None) -> int:
    now = now or datetime.utcnow()
    expires_before = now - PHOTO_BACKGROUND_RESULT_TTL
    expired_paths = []
    with Session(get_engine()) as session:
        completed_jobs = list(
            session.exec(
                select(PhotoBackgroundJobRecord).where(
                    PhotoBackgroundJobRecord.status.in_(TERMINAL_PHOTO_BACKGROUND_JOB_STATUSES)
                )
            )
        )
        expired_jobs = [
            job
            for job in completed_jobs
            if job.completed_at is not None and job.completed_at <= expires_before
        ]
        if not expired_jobs:
            return 0

        expired_job_ids = {job.id for job in expired_jobs}
        expired_file_ids = {
            file_id
            for job in expired_jobs
            for file_id in (job.input_file_id, job.result_file_id)
            if file_id
        }
        for activity in session.exec(
            select(ActivityRecord).where(ActivityRecord.kind == "photo_blue_background")
        ):
            if (activity.detail or {}).get("job_id") in expired_job_ids:
                session.delete(activity)
        for job in expired_jobs:
            session.delete(job)
        session.flush()
        for file_id in expired_file_ids:
            file_record = session.get(FileRecord, file_id)
            if file_record is None:
                continue
            expired_paths.append(absolute_path(file_record.path))
            session.delete(file_record)
        session.commit()

    for path in expired_paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            continue
    return len(expired_jobs)


def start_photo_background_worker() -> None:
    global _worker_thread, _cleanup_thread
    with _worker_lock:
        if _worker_thread is not None and _worker_thread.is_alive():
            return
        recover_photo_background_jobs()
        cleanup_expired_photo_background_jobs()
        _worker_stop.clear()
        _worker_wake.set()
        _start_photo_background_warmup()
        _worker_thread = threading.Thread(target=_worker_loop, name="qxban-photo-worker", daemon=True)
        _cleanup_thread = threading.Thread(target=_cleanup_loop, name="qxban-photo-cleanup", daemon=True)
        _worker_thread.start()
        _cleanup_thread.start()


def stop_photo_background_worker() -> None:
    _worker_stop.set()
    _worker_wake.set()
    _warmup_done.set()


def _worker_loop() -> None:
    while not _worker_stop.is_set():
        if photo_background_warmup_state()["status"] == "warming":
            _warmup_done.wait(timeout=2)
            continue
        job_id = _claim_next_photo_background_job()
        if job_id is not None:
            process_photo_background_job(job_id)
            continue
        _worker_wake.wait(timeout=2)
        _worker_wake.clear()


def _cleanup_loop() -> None:
    while not _worker_stop.wait(timeout=PHOTO_BACKGROUND_CLEANUP_INTERVAL_SECONDS):
        cleanup_expired_photo_background_jobs()


def _claim_next_photo_background_job() -> str | None:
    with Session(get_engine()) as session:
        job = session.exec(
            select(PhotoBackgroundJobRecord)
            .where(PhotoBackgroundJobRecord.status == "queued")
            .order_by(PhotoBackgroundJobRecord.created_at, PhotoBackgroundJobRecord.id)
        ).first()
        if job is None:
            return None
        job.status = "running"
        job.started_at = datetime.utcnow()
        job.error_message = ""
        session.add(job)
        session.commit()
        return job.id


def _add_activity(session: Session, project_id: int, message: str, detail: dict, level: str = "info") -> None:
    session.add(
        ActivityRecord(
            id=uuid.uuid4().hex,
            project_id=project_id,
            kind="photo_blue_background",
            message=message,
            detail=detail,
            level=level,
        )
    )


def _finish_job_failure(job_id: str, reason: str, student_name: str = "该学生") -> None:
    with Session(get_engine()) as session:
        job = session.get(PhotoBackgroundJobRecord, job_id)
        if job is None:
            return
        job.status = "failed"
        job.error_message = reason
        job.completed_at = datetime.utcnow()
        session.add(job)
        _add_activity(
            session,
            job.project_id,
            f"{student_name}蓝底设置失败",
            {"job_id": job.id, "student_id": job.student_id, "error": reason},
            level="error",
        )
        session.commit()


def process_photo_background_job(job_id: str) -> None:
    with Session(get_engine()) as session:
        job = session.get(PhotoBackgroundJobRecord, job_id)
        if job is None or job.status != "running":
            return
        project = session.get(ProjectRecord, job.project_id)
        student = session.get(StudentRecord, job.student_id)
        input_record = session.get(FileRecord, job.input_file_id)
        if project is None:
            reason = "班级项目不存在"
        elif student is None:
            reason = "对应学生不存在"
        elif input_record is None:
            reason = "原始照片不存在"
        else:
            source = absolute_path(input_record.path)
            reason = "" if source.exists() else "原始照片文件不存在"
        student_name = student.name if student is not None else "该学生"
        project_id = job.project_id
        student_id = job.student_id
        filename = input_record.filename if input_record is not None else "照片"

    if reason:
        _finish_job_failure(job_id, reason, student_name)
        return

    try:
        target = create_blue_background_photo(
            source,
            get_settings().photos_dir / str(project_id),
            filename,
        )
    except (RuntimeError, ValueError) as exc:
        _finish_job_failure(job_id, str(exc), student_name)
        return
    except Exception as exc:  # Keep the worker alive if a model/runtime error escapes the core helper.
        _finish_job_failure(job_id, f"蓝底处理异常：{exc}", student_name)
        return

    with Session(get_engine()) as session:
        job = session.get(PhotoBackgroundJobRecord, job_id)
        if job is None:
            return
        result = create_file_record(
            session,
            target,
            target.name,
            "photo_blue_background",
            project_id,
            BLUE_BACKGROUND_CONTENT_TYPE,
        )
        job.status = "succeeded"
        job.result_file_id = result.id
        job.error_message = ""
        job.completed_at = datetime.utcnow()
        session.add(job)
        _add_activity(
            session,
            project_id,
            f"{student_name}蓝底设置成功",
            {
                "highlight": True,
                "job_id": job.id,
                "student_id": student_id,
                "file_id": result.id,
                "download_url": f"/api/v1/files/{result.id}/download",
            },
            level="success",
        )
        session.commit()
