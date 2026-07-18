from __future__ import annotations

import uuid
import re
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from sqlmodel import Session, select

from qx_core import (
    DormRoom,
    Student,
    export_dorm_roster_to_excel,
    export_photo_import_report_to_excel,
    export_photo_status_report_to_excel,
    export_students_to_excel,
    layout_from_dict,
    layout_to_dict,
    load_dorm_rooms_from_excel,
    load_students_from_excel,
    reset_layout_for_students,
)
from qx_core.pdf_export import export_seat_pdf, export_stickers_pdf
from qx_core.photos import (
    IMAGE_EXTENSIONS,
    MANAGED_PHOTO_CONTENT_TYPE,
    PHOTO_BACKGROUND_DEPENDENCY_MESSAGE,
    copy_managed_photo,
    normalize_name,
    photo_background_available,
    photo_sequence_number,
    photo_sequence_summary,
)

from .config import ensure_data_dirs, get_settings
from .db import get_session, init_db
from .files import absolute_path, create_file_record, register_export, save_upload_file
from .models import ActivityRecord, DormRoomRecord, FileRecord, PhotoBackgroundJobRecord, ProjectRecord, SeatLayoutRecord, StudentRecord
from .photo_jobs import (
    notify_photo_background_worker,
    photo_background_warmup_state,
    queue_ahead_count,
    start_photo_background_worker,
    stop_photo_background_worker,
)
from .schemas import (
    ActivityOut,
    AttachPhotoRequest,
    DormRoomIn,
    DormRoomsIn,
    DormRoomsOut,
    ExportDormsRequest,
    FileOut,
    ImportDormsOut,
    ImportStudentsOut,
    PhotoImportItemOut,
    PhotoImportOut,
    PhotoBackgroundJobOut,
    PhotoSequenceGapStudentOut,
    ProjectCreate,
    ProjectOut,
    ProjectPatch,
    RecentDormRosterOut,
    StudentCreate,
    SeatLayoutIn,
    SeatLayoutOut,
    StickerExportRequest,
    StudentOut,
    StudentPatch,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_data_dirs()
    init_db()
    start_photo_background_worker()
    try:
        yield
    finally:
        stop_photo_background_worker()


app = FastAPI(title="QX班小助 API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DORM_ROSTER_FILE_KINDS = ("dorm_excel", "dorm_roster")


def get_project_or_404(session: Session, project_id: int) -> ProjectRecord:
    project = session.get(ProjectRecord, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


def file_download_url(file_id: str) -> str:
    return f"/api/v1/files/{file_id}/download"


def student_to_core(record: StudentRecord) -> Student:
    photo_path = absolute_path(record.photo_path) if record.photo_path else None
    return Student(
        index=record.student_index,
        name=record.name,
        hometown=record.hometown,
        class_name=record.class_name,
        photo_path=photo_path if photo_path and photo_path.exists() else None,
        photo_match_status=record.photo_match_status,
        original_index=record.student_index,
        dorm_key=str(record.id or ""),
    )


def student_to_out(record: StudentRecord, session: Session) -> StudentOut:
    photo_url = None
    if record.photo_path:
        file_record = session.exec(
            select(FileRecord).where(FileRecord.path == record.photo_path).order_by(FileRecord.created_at.desc())
        ).first()
        if file_record:
            photo_url = file_download_url(file_record.id)
    return StudentOut(
        id=record.id or 0,
        index=record.student_index,
        name=record.name,
        hometown=record.hometown,
        class_name=record.class_name,
        photo_match_status=record.photo_match_status,
        photo_url=photo_url,
    )


def project_students(session: Session, project_id: int) -> list[StudentRecord]:
    return list(
        session.exec(
            select(StudentRecord)
            .where(StudentRecord.project_id == project_id)
            .order_by(StudentRecord.student_index, StudentRecord.id)
        )
    )


def project_students_core(session: Session, project_id: int) -> list[Student]:
    return [student_to_core(record) for record in project_students(session, project_id)]


def clear_project_students(session: Session, project_id: int) -> None:
    for job in session.exec(select(PhotoBackgroundJobRecord).where(PhotoBackgroundJobRecord.project_id == project_id)):
        session.delete(job)
    for record in project_students(session, project_id):
        session.delete(record)
    for record in session.exec(select(DormRoomRecord).where(DormRoomRecord.project_id == project_id)):
        session.delete(record)
    for record in session.exec(select(SeatLayoutRecord).where(SeatLayoutRecord.project_id == project_id)):
        session.delete(record)
    session.commit()


def upsert_seat_layout(session: Session, project_id: int, layout: dict) -> SeatLayoutRecord:
    layout = layout_to_dict(layout_from_dict(layout))
    record = session.exec(select(SeatLayoutRecord).where(SeatLayoutRecord.project_id == project_id)).first()
    if record is None:
        record = SeatLayoutRecord(project_id=project_id, layout=layout)
        session.add(record)
    else:
        record.layout = layout
        record.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(record)
    return record


def ensure_seat_layout(session: Session, project_id: int) -> dict:
    record = session.exec(select(SeatLayoutRecord).where(SeatLayoutRecord.project_id == project_id)).first()
    if record and record.layout:
        layout = layout_to_dict(layout_from_dict(record.layout))
        if layout != record.layout:
            record.layout = layout
            record.updated_at = datetime.utcnow()
            session.add(record)
            session.commit()
            session.refresh(record)
        return layout
    layout = reset_layout_for_students(project_students_core(session, project_id))
    return upsert_seat_layout(session, project_id, layout_to_dict(layout)).layout


def reset_project_seat_layout(session: Session, project_id: int) -> SeatLayoutRecord:
    layout = reset_layout_for_students(project_students_core(session, project_id))
    return upsert_seat_layout(session, project_id, layout_to_dict(layout))


def replace_dorm_rooms(session: Session, project_id: int, rooms: list[DormRoom]) -> None:
    for record in session.exec(select(DormRoomRecord).where(DormRoomRecord.project_id == project_id)):
        session.delete(record)
    session.commit()
    for order, room in enumerate(rooms):
        session.add(DormRoomRecord(project_id=project_id, room_order=order, number=room.number, beds=room.beds))
    session.commit()


def project_dorm_rooms(session: Session, project_id: int) -> list[DormRoom]:
    records = session.exec(
        select(DormRoomRecord).where(DormRoomRecord.project_id == project_id).order_by(DormRoomRecord.room_order)
    )
    return [DormRoom(number=record.number, beds=record.beds or []) for record in records]


def export_file_response(record: FileRecord) -> FileOut:
    return FileOut(file_id=record.id, filename=record.filename, download_url=file_download_url(record.id))


def photo_background_job_to_out(record: PhotoBackgroundJobRecord, session: Session) -> PhotoBackgroundJobOut:
    student = session.get(StudentRecord, record.student_id)
    input_record = session.get(FileRecord, record.input_file_id)
    result_record = session.get(FileRecord, record.result_file_id) if record.result_file_id else None
    return PhotoBackgroundJobOut(
        id=record.id,
        status=record.status,
        queue_ahead_count=queue_ahead_count(session, record.id),
        student_id=record.student_id,
        student_name=student.name if student is not None else "已删除学生",
        filename=input_record.filename if input_record is not None else "照片",
        result=export_file_response(result_record) if result_record is not None else None,
        error_message=record.error_message,
        created_at=record.created_at,
        started_at=record.started_at,
        completed_at=record.completed_at,
    )


def archive_photo_name(student: StudentRecord) -> str:
    safe_name = re.sub(r'[\\/:*?"<>|\s]+', "_", student.name.strip()).strip("_")
    if not safe_name:
        safe_name = f"student-{student.id or student.student_index}"
    suffix = Path(student.photo_path).suffix.lower() or ".png"
    return f"{student.student_index:02d}_{safe_name}{suffix}"


def student_report_row(student: StudentRecord) -> dict[str, object]:
    return {
        "id": student.id or 0,
        "index": student.student_index,
        "name": student.name,
        "hometown": student.hometown,
        "class_name": student.class_name,
        "photo_path": student.photo_path,
        "photo_match_status": student.photo_match_status,
    }


def sequence_gap_students(missing_sequence_numbers: list[int], students: list[StudentRecord]) -> list[PhotoSequenceGapStudentOut]:
    students_by_index: dict[int, StudentRecord] = {}
    for student in students:
        students_by_index.setdefault(student.student_index, student)
    rows: list[PhotoSequenceGapStudentOut] = []
    for number in missing_sequence_numbers:
        student = students_by_index.get(number)
        if student is None:
            continue
        rows.append(
            PhotoSequenceGapStudentOut(
                index=number,
                student_id=student.id or 0,
                name=student.name,
                photo_bound=bool(student.photo_path),
                photo_match_status=student.photo_match_status,
            )
        )
    return rows


def activity_to_out(record: ActivityRecord) -> ActivityOut:
    return ActivityOut(
        id=record.id,
        project_id=record.project_id,
        kind=record.kind,
        message=record.message,
        level=record.level,
        detail=record.detail or {},
        created_at=record.created_at,
    )


def log_activity(
    session: Session,
    project_id: int | None,
    kind: str,
    message: str,
    detail: dict | None = None,
    level: str = "info",
) -> None:
    session.add(
        ActivityRecord(
            id=uuid.uuid4().hex,
            project_id=project_id,
            kind=kind,
            message=message,
            detail=detail or {},
            level=level,
        )
    )
    session.commit()


def recent_dorm_roster_response(record: FileRecord) -> RecentDormRosterOut:
    return RecentDormRosterOut(
        file_id=record.id,
        filename=record.filename,
        download_url=file_download_url(record.id),
        created_at=record.created_at,
    )


def resource_path(file_name: str) -> Path:
    return Path(__file__).resolve().parents[2] / "resources" / file_name


def uploaded_image_metadata(record: FileRecord) -> dict[str, int | str | None]:
    try:
        with Image.open(absolute_path(record.path)) as image:
            return {
                "image_width": image.width,
                "image_height": image.height,
                "image_format": image.format or "",
            }
    except (OSError, UnidentifiedImageError):
        return {"image_width": None, "image_height": None, "image_format": None}


def match_uploaded_photo_to_student(
    filename: str,
    students: list[StudentRecord],
    used_student_ids: set[int],
) -> tuple[StudentRecord | None, str, str]:
    stem = Path(filename).stem.strip()
    exact_matches = [student for student in students if student.name.strip() == stem]
    if len(exact_matches) == 1:
        student = exact_matches[0]
        if student.id in used_student_ids:
            return None, "duplicate", f"{student.name} 本次已匹配过照片"
        return student, "strict", "文件名与学生姓名完全一致"
    if len(exact_matches) > 1:
        return None, "ambiguous", "文件名匹配到多个同名学生"

    photo_key = normalize_name(stem)
    if not photo_key:
        return None, "unmatched", "文件名缺少学生姓名"
    normalized_matches = [student for student in students if normalize_name(student.name) == photo_key]
    if len(normalized_matches) == 1:
        student = normalized_matches[0]
        if student.id in used_student_ids:
            return None, "duplicate", f"{student.name} 本次已匹配过照片"
        return student, "strict", "文件名清理序号后与学生姓名一致"
    if len(normalized_matches) > 1:
        return None, "ambiguous", "文件名清理序号后匹配到多个学生"

    fuzzy_matches = [
        student
        for student in students
        if normalize_name(student.name) in photo_key
    ]
    if len(fuzzy_matches) == 1:
        student = fuzzy_matches[0]
        if student.id in used_student_ids:
            return None, "duplicate", f"{student.name} 本次已匹配过照片"
        return student, "fuzzy", "文件名包含学生姓名"
    if len(fuzzy_matches) > 1:
        return None, "ambiguous", "文件名匹配到多个学生"
    return None, "unmatched", "未匹配到学生"


def suggest_student_by_photo_sequence(
    filename: str,
    students: list[StudentRecord],
    used_student_ids: set[int],
    uploaded_photo_keys: set[str],
) -> tuple[int | None, StudentRecord | None]:
    sequence_number = photo_sequence_number(filename)
    if sequence_number is None:
        return None, None
    matches = [student for student in students if student.student_index == sequence_number]
    if len(matches) != 1:
        return sequence_number, None
    student = matches[0]
    if student.id in used_student_ids:
        return sequence_number, None
    student_key = normalize_name(student.name)
    if student_key and any(student_key in photo_key for photo_key in uploaded_photo_keys):
        return sequence_number, None
    return sequence_number, student


def bind_file_record_to_student(
    session: Session,
    project_id: int,
    student: StudentRecord,
    file_record: FileRecord,
    match_status: str,
) -> StudentRecord:
    source = absolute_path(file_record.path)
    target = copy_managed_photo(source, get_settings().photos_dir / str(project_id), student.id or 0, file_record.filename)
    photo_record = create_file_record(session, target, Path(target).name, "student_photo", project_id, MANAGED_PHOTO_CONTENT_TYPE)
    student.photo_path = photo_record.path
    student.photo_match_status = match_status
    session.add(student)
    session.commit()
    session.refresh(student)
    return student


def import_dorm_rooms_from_path(session: Session, project_id: int, path: Path) -> ImportDormsOut:
    students = project_students_core(session, project_id)
    if not students:
        raise HTTPException(status_code=400, detail="请先导入学生名单")
    rooms, matched_count = load_dorm_rooms_from_excel(path, students)
    replace_dorm_rooms(session, project_id, rooms)
    payload = [DormRoomIn(number=room.number, beds=room.beds) for room in rooms]
    return ImportDormsOut(room_count=len(rooms), matched_count=matched_count, rooms=payload)


@app.get("/api/v1/health")
def health() -> dict:
    settings = get_settings()
    background_available = settings.photo_background_enabled and photo_background_available()
    warmup = photo_background_warmup_state()
    return {
        "ok": True,
        "data_dir": str(settings.data_dir),
        "photo_task_concurrency": settings.photo_task_concurrency,
        "photo_background_enabled": background_available,
        "photo_background_configured": settings.photo_background_enabled,
        "photo_background_warmup_status": warmup["status"],
        "photo_background_warmup_error": warmup["error"],
    }


@app.post("/api/v1/projects", response_model=ProjectOut)
def create_project(payload: ProjectCreate, session: Session = Depends(get_session)) -> ProjectRecord:
    project = ProjectRecord(name=payload.name.strip() or "新班级项目")
    session.add(project)
    session.commit()
    session.refresh(project)
    upsert_seat_layout(session, project.id or 0, layout_to_dict(reset_layout_for_students([])))
    log_activity(session, project.id, "project", f"创建班级：{project.name}")
    return project


@app.get("/api/v1/projects", response_model=list[ProjectOut])
def list_projects(session: Session = Depends(get_session)) -> list[ProjectRecord]:
    return list(session.exec(select(ProjectRecord).order_by(ProjectRecord.created_at.desc())))


@app.get("/api/v1/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, session: Session = Depends(get_session)) -> ProjectRecord:
    return get_project_or_404(session, project_id)


@app.get("/api/v1/projects/{project_id}/activities", response_model=list[ActivityOut])
def list_activities(project_id: int, limit: int = 20, session: Session = Depends(get_session)) -> list[ActivityOut]:
    get_project_or_404(session, project_id)
    limit = max(1, min(50, limit))
    records = session.exec(
        select(ActivityRecord)
        .where(ActivityRecord.project_id == project_id)
        .order_by(ActivityRecord.created_at.desc())
        .limit(limit)
    )
    return [activity_to_out(record) for record in records]


@app.patch("/api/v1/projects/{project_id}", response_model=ProjectOut)
def patch_project(project_id: int, payload: ProjectPatch, session: Session = Depends(get_session)) -> ProjectRecord:
    project = get_project_or_404(session, project_id)
    if payload.name is not None:
        old_name = project.name
        project.name = payload.name.strip() or "新班级项目"
        session.add(project)
        for student in project_students(session, project_id):
            student.class_name = project.name
            session.add(student)
        session.commit()
        session.refresh(project)
        log_activity(session, project_id, "project", f"班级改名：{old_name} -> {project.name}")
    return project


@app.get("/api/v1/templates/student-info/download")
def download_student_info_template() -> FileResponse:
    path = resource_path("学生信息表样表.xlsx")
    if not path.exists():
        raise HTTPException(status_code=404, detail="学生信息表样表不存在")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="学生信息表样表.xlsx",
    )


@app.post("/api/v1/projects/{project_id}/students/import-excel", response_model=ImportStudentsOut)
def import_students_excel(project_id: int, file: UploadFile = File(...), session: Session = Depends(get_session)) -> ImportStudentsOut:
    project = get_project_or_404(session, project_id)
    upload_record = save_upload_file(session, file, project_id, "student_excel", {".xlsx", ".xlsm"})
    excel_path = absolute_path(upload_record.path)
    students = load_students_from_excel(excel_path)
    clear_project_students(session, project_id)
    for student in students:
        session.add(
            StudentRecord(
                project_id=project_id,
                student_index=student.index,
                name=student.name,
                hometown=student.hometown,
                class_name=project.name,
            )
        )
    session.commit()
    layout = reset_layout_for_students(project_students_core(session, project_id), source_excel_path=excel_path)
    upsert_seat_layout(session, project_id, layout_to_dict(layout))
    records = project_students(session, project_id)
    log_activity(session, project_id, "students", f"导入学生名单：{len(records)} 名学生", {"filename": upload_record.filename})
    return ImportStudentsOut(imported_count=len(records), students=[student_to_out(record, session) for record in records])


@app.get("/api/v1/projects/{project_id}/students", response_model=list[StudentOut])
def list_students(project_id: int, session: Session = Depends(get_session)) -> list[StudentOut]:
    get_project_or_404(session, project_id)
    return [student_to_out(record, session) for record in project_students(session, project_id)]


@app.post("/api/v1/projects/{project_id}/students", response_model=StudentOut)
def create_student(project_id: int, payload: StudentCreate, session: Session = Depends(get_session)) -> StudentOut:
    project = get_project_or_404(session, project_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="学生姓名不能为空")
    existing_students = project_students(session, project_id)
    next_index = max((student.student_index for student in existing_students), default=0) + 1
    record = StudentRecord(
        project_id=project_id,
        student_index=next_index,
        name=name,
        hometown=payload.hometown.strip(),
        class_name=project.name,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    reset_project_seat_layout(session, project_id)
    log_activity(session, project_id, "students", f"新增学生：{record.name}")
    return student_to_out(record, session)


@app.patch("/api/v1/projects/{project_id}/students/{student_id}", response_model=StudentOut)
def patch_student(project_id: int, student_id: int, payload: StudentPatch, session: Session = Depends(get_session)) -> StudentOut:
    project = get_project_or_404(session, project_id)
    record = session.get(StudentRecord, student_id)
    if record is None or record.project_id != project_id:
        raise HTTPException(status_code=404, detail="学生不存在")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="学生姓名不能为空")
        record.name = name
    if payload.hometown is not None:
        record.hometown = payload.hometown.strip()
    if payload.class_name is not None:
        record.class_name = project.name
    session.add(record)
    session.commit()
    session.refresh(record)
    log_activity(session, project_id, "students", f"更新学生：{record.name}")
    return student_to_out(record, session)


@app.delete("/api/v1/projects/{project_id}/students/{student_id}")
def delete_student(project_id: int, student_id: int, session: Session = Depends(get_session)) -> dict:
    get_project_or_404(session, project_id)
    record = session.get(StudentRecord, student_id)
    if record is None or record.project_id != project_id:
        raise HTTPException(status_code=404, detail="学生不存在")
    deleted_name = record.name
    for job in session.exec(select(PhotoBackgroundJobRecord).where(PhotoBackgroundJobRecord.student_id == student_id)):
        session.delete(job)
    session.delete(record)
    session.commit()
    for index, item in enumerate(project_students(session, project_id), start=1):
        item.student_index = index
        session.add(item)
    deleted_key = str(student_id)
    for room in session.exec(select(DormRoomRecord).where(DormRoomRecord.project_id == project_id)):
        room.beds = [None if key == deleted_key else key for key in room.beds]
        session.add(room)
    session.commit()
    reset_project_seat_layout(session, project_id)
    log_activity(session, project_id, "students", f"删除学生：{deleted_name}")
    return {"deleted": True}


@app.post("/api/v1/projects/{project_id}/students/export-excel", response_model=FileOut)
def export_students_excel(project_id: int, session: Session = Depends(get_session)) -> FileOut:
    get_project_or_404(session, project_id)
    settings = get_settings()
    target = settings.exports_dir / str(project_id) / f"学生信息-{uuid.uuid4().hex[:8]}.xlsx"
    export_students_to_excel(target, project_students_core(session, project_id))
    record = register_export(session, target, target.name, project_id, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    log_activity(session, project_id, "students", f"导出学生信息：{target.name}")
    return export_file_response(record)


@app.post("/api/v1/projects/{project_id}/photos/upload", response_model=FileOut)
def upload_photo(project_id: int, file: UploadFile = File(...), session: Session = Depends(get_session)) -> FileOut:
    get_project_or_404(session, project_id)
    try:
        record = save_upload_file(session, file, project_id, "photo_upload", IMAGE_EXTENSIONS)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    image_info = uploaded_image_metadata(record)
    if image_info["image_width"] is None or image_info["image_height"] is None:
        absolute_path(record.path).unlink(missing_ok=True)
        session.delete(record)
        session.commit()
        raise HTTPException(status_code=400, detail="图片文件无法读取，请检查图片是否损坏。")
    return export_file_response(record)


@app.post("/api/v1/projects/{project_id}/photos/blue-background", response_model=PhotoBackgroundJobOut)
def queue_photo_blue_background(
    project_id: int,
    student_id: int = Form(...),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> PhotoBackgroundJobOut:
    get_project_or_404(session, project_id)
    student = session.get(StudentRecord, student_id)
    if student is None or student.project_id != project_id:
        raise HTTPException(status_code=404, detail="选择的学生不存在")
    settings = get_settings()
    if not settings.photo_background_enabled:
        raise HTTPException(status_code=503, detail="蓝底抠图功能未启用。")
    if not photo_background_available():
        raise HTTPException(status_code=503, detail=PHOTO_BACKGROUND_DEPENDENCY_MESSAGE)
    try:
        upload_record = save_upload_file(session, file, project_id, "photo_upload", IMAGE_EXTENSIONS)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    image_info = uploaded_image_metadata(upload_record)
    if image_info["image_width"] is None or image_info["image_height"] is None:
        absolute_path(upload_record.path).unlink(missing_ok=True)
        session.delete(upload_record)
        session.commit()
        raise HTTPException(status_code=400, detail="图片文件无法读取，请检查图片是否损坏。")
    job = PhotoBackgroundJobRecord(
        id=uuid.uuid4().hex,
        project_id=project_id,
        student_id=student.id or 0,
        input_file_id=upload_record.id,
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    ahead_count = queue_ahead_count(session, job.id)
    log_activity(
        session,
        project_id,
        "photo_blue_background",
        f"{student.name}蓝底设置已加入队列",
        {"job_id": job.id, "student_id": student.id, "queue_ahead_count": ahead_count},
    )
    notify_photo_background_worker()
    return photo_background_job_to_out(job, session)


@app.get("/api/v1/projects/{project_id}/photos/blue-background/jobs/{job_id}", response_model=PhotoBackgroundJobOut)
def get_photo_blue_background_job(
    project_id: int,
    job_id: str,
    session: Session = Depends(get_session),
) -> PhotoBackgroundJobOut:
    get_project_or_404(session, project_id)
    job = session.get(PhotoBackgroundJobRecord, job_id)
    if job is None or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="蓝底作业不存在")
    return photo_background_job_to_out(job, session)


@app.post("/api/v1/projects/{project_id}/students/{student_id}/photo", response_model=StudentOut)
def attach_student_photo(project_id: int, student_id: int, payload: AttachPhotoRequest, session: Session = Depends(get_session)) -> StudentOut:
    get_project_or_404(session, project_id)
    student = session.get(StudentRecord, student_id)
    file_record = session.get(FileRecord, payload.file_id)
    if student is None or student.project_id != project_id:
        raise HTTPException(status_code=404, detail="学生不存在")
    if file_record is None or file_record.project_id != project_id:
        raise HTTPException(status_code=404, detail="图片不存在")
    try:
        student = bind_file_record_to_student(session, project_id, student, file_record, "manual")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log_activity(session, project_id, "photos", f"绑定照片：{student.name}", {"filename": file_record.filename})
    return student_to_out(student, session)


@app.delete("/api/v1/projects/{project_id}/students/{student_id}/photo", response_model=StudentOut)
def clear_student_photo(project_id: int, student_id: int, session: Session = Depends(get_session)) -> StudentOut:
    get_project_or_404(session, project_id)
    student = session.get(StudentRecord, student_id)
    if student is None or student.project_id != project_id:
        raise HTTPException(status_code=404, detail="学生不存在")
    previous_photo_path = student.photo_path
    student.photo_path = ""
    student.photo_match_status = "missing"
    session.add(student)
    session.commit()
    session.refresh(student)
    log_activity(session, project_id, "photos", f"清除照片：{student.name}", {"previous_photo_path": previous_photo_path})
    return student_to_out(student, session)


@app.post("/api/v1/projects/{project_id}/photos/import", response_model=PhotoImportOut)
def import_photos(project_id: int, files: list[UploadFile] = File(...), session: Session = Depends(get_session)) -> PhotoImportOut:
    get_project_or_404(session, project_id)
    students = project_students(session, project_id)
    if not students:
        raise HTTPException(status_code=400, detail="请先导入学生名单")
    used_student_ids: set[int] = set()
    results: list[PhotoImportItemOut] = []
    matched_count = 0
    uploaded_filenames = [upload.filename or "" for upload in files]
    uploaded_photo_keys = {normalize_name(Path(filename).stem) for filename in uploaded_filenames}
    uploaded_photo_keys.discard("")
    sequence_numbers, missing_sequence_numbers = photo_sequence_summary(uploaded_filenames)

    for upload in files:
        original_filename = upload.filename or "未命名图片"
        original_sequence_number = photo_sequence_number(original_filename)
        try:
            upload_record = save_upload_file(session, upload, project_id, "photo_upload", IMAGE_EXTENSIONS)
        except ValueError as exc:
            results.append(
                PhotoImportItemOut(
                    filename=original_filename,
                    status="rejected",
                    message=str(exc),
                    sequence_number=original_sequence_number,
                )
            )
            continue

        image_info = uploaded_image_metadata(upload_record)
        if image_info["image_width"] is None or image_info["image_height"] is None:
            results.append(
                PhotoImportItemOut(
                    filename=upload_record.filename,
                    status="rejected",
                    message="图片文件无法读取，请检查图片是否损坏。",
                    **image_info,
                    sequence_number=photo_sequence_number(upload_record.filename),
                    file_id=upload_record.id,
                    download_url=file_download_url(upload_record.id),
                )
            )
            continue

        student, status, message = match_uploaded_photo_to_student(upload_record.filename, students, used_student_ids)
        sequence_number, suggested_student = suggest_student_by_photo_sequence(
            upload_record.filename,
            students,
            used_student_ids,
            uploaded_photo_keys,
        )
        if student is None:
            results.append(
                PhotoImportItemOut(
                    filename=upload_record.filename,
                    status=status,
                    message=message,
                    **image_info,
                    sequence_number=sequence_number,
                    suggested_student_id=suggested_student.id if suggested_student else None,
                    suggested_student_name=suggested_student.name if suggested_student else None,
                    suggested_student_index=suggested_student.student_index if suggested_student else None,
                    file_id=upload_record.id,
                    download_url=file_download_url(upload_record.id),
                )
            )
            continue

        try:
            bind_file_record_to_student(session, project_id, student, upload_record, status)
        except ValueError as exc:
            results.append(
                PhotoImportItemOut(
                    filename=upload_record.filename,
                    status="rejected",
                    message=str(exc),
                    **image_info,
                    sequence_number=sequence_number,
                    file_id=upload_record.id,
                    download_url=file_download_url(upload_record.id),
                )
            )
            continue
        if student.id is not None:
            used_student_ids.add(student.id)
        matched_count += 1
        results.append(
            PhotoImportItemOut(
                filename=upload_record.filename,
                status=status,
                message=message,
                **image_info,
                student_id=student.id,
                student_name=student.name,
                sequence_number=sequence_number,
                file_id=upload_record.id,
                download_url=file_download_url(upload_record.id),
            )
        )

    unmatched_count = len(results) - matched_count
    current_students = project_students(session, project_id)
    sequence_gap_student_rows = sequence_gap_students(missing_sequence_numbers, current_students)
    settings = get_settings()
    report_target = settings.exports_dir / str(project_id) / f"照片导入核对清单-{uuid.uuid4().hex[:8]}.xlsx"
    export_photo_import_report_to_excel(
        report_target,
        matched_count,
        unmatched_count,
        sequence_numbers,
        missing_sequence_numbers,
        [item.model_dump() for item in results],
        [student_report_row(student) for student in current_students],
    )
    report_record = register_export(
        session,
        report_target,
        report_target.name,
        project_id,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    log_activity(
        session,
        project_id,
        "photos",
        f"批量导入照片：匹配 {matched_count} 张，未匹配 {unmatched_count} 张",
        {
            "matched_count": matched_count,
            "unmatched_count": unmatched_count,
            "sequence_numbers": sequence_numbers,
            "missing_sequence_numbers": missing_sequence_numbers,
            "sequence_gap_students": [item.model_dump() for item in sequence_gap_student_rows],
            "report_file_id": report_record.id,
        },
    )
    return PhotoImportOut(
        matched_count=matched_count,
        unmatched_count=unmatched_count,
        sequence_numbers=sequence_numbers,
        missing_sequence_numbers=missing_sequence_numbers,
        sequence_gap_students=sequence_gap_student_rows,
        report_file_id=report_record.id,
        report_filename=report_record.filename,
        report_download_url=file_download_url(report_record.id),
        results=results,
    )


@app.post("/api/v1/projects/{project_id}/photos/export-zip", response_model=FileOut)
def export_bound_photos_zip(project_id: int, session: Session = Depends(get_session)) -> FileOut:
    get_project_or_404(session, project_id)
    settings = get_settings()
    target = settings.exports_dir / str(project_id) / f"已绑定学生照片-{uuid.uuid4().hex[:8]}.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    exported_count = 0
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for student in project_students(session, project_id):
            if not student.photo_path:
                continue
            photo_path = absolute_path(student.photo_path)
            if not photo_path.exists():
                continue
            archive.write(photo_path, archive_photo_name(student))
            exported_count += 1
    if exported_count == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="暂无已绑定照片可导出")
    record = register_export(session, target, target.name, project_id, "application/zip")
    log_activity(session, project_id, "photos", f"导出已绑定照片包：{exported_count} 张")
    return export_file_response(record)


@app.post("/api/v1/projects/{project_id}/photos/status-report", response_model=FileOut)
def export_photo_status_report(project_id: int, session: Session = Depends(get_session)) -> FileOut:
    get_project_or_404(session, project_id)
    students = project_students(session, project_id)
    settings = get_settings()
    target = settings.exports_dir / str(project_id) / f"照片状态清单-{uuid.uuid4().hex[:8]}.xlsx"
    export_photo_status_report_to_excel(target, [student_report_row(student) for student in students])
    record = register_export(
        session,
        target,
        target.name,
        project_id,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    bound_count = sum(1 for student in students if student.photo_path)
    log_activity(session, project_id, "photos", f"导出照片状态清单：已绑定 {bound_count} 名，缺照片 {len(students) - bound_count} 名")
    return export_file_response(record)


@app.get("/api/v1/projects/{project_id}/seats", response_model=SeatLayoutOut)
def get_seats(project_id: int, session: Session = Depends(get_session)) -> SeatLayoutOut:
    get_project_or_404(session, project_id)
    return SeatLayoutOut(layout=ensure_seat_layout(session, project_id))


@app.put("/api/v1/projects/{project_id}/seats", response_model=SeatLayoutOut)
def put_seats(project_id: int, payload: SeatLayoutIn, session: Session = Depends(get_session)) -> SeatLayoutOut:
    get_project_or_404(session, project_id)
    record = upsert_seat_layout(session, project_id, payload.layout)
    log_activity(session, project_id, "seats", "保存座位表")
    return SeatLayoutOut(layout=record.layout)


@app.post("/api/v1/projects/{project_id}/seats/reset", response_model=SeatLayoutOut)
def reset_seats(project_id: int, session: Session = Depends(get_session)) -> SeatLayoutOut:
    get_project_or_404(session, project_id)
    record = reset_project_seat_layout(session, project_id)
    log_activity(session, project_id, "seats", "重置座位表")
    return SeatLayoutOut(layout=record.layout)


@app.post("/api/v1/projects/{project_id}/seats/export-pdf", response_model=FileOut)
def export_seats_pdf(project_id: int, session: Session = Depends(get_session)) -> FileOut:
    get_project_or_404(session, project_id)
    target = get_settings().exports_dir / str(project_id) / f"班级座位表-{uuid.uuid4().hex[:8]}.pdf"
    export_seat_pdf(target, ensure_seat_layout(session, project_id))
    record = register_export(session, target, target.name, project_id, "application/pdf")
    log_activity(session, project_id, "seats", f"导出座位表：{target.name}")
    return export_file_response(record)


@app.post("/api/v1/projects/{project_id}/dorms/import-excel", response_model=ImportDormsOut)
def import_dorms_excel(project_id: int, file: UploadFile = File(...), session: Session = Depends(get_session)) -> ImportDormsOut:
    get_project_or_404(session, project_id)
    upload_record = save_upload_file(session, file, project_id, "dorm_excel", {".xlsx", ".xlsm"})
    result = import_dorm_rooms_from_path(session, project_id, absolute_path(upload_record.path))
    log_activity(session, project_id, "dorms", f"读取宿舍表：{result.room_count} 个宿舍，匹配 {result.matched_count} 名学生", {"filename": upload_record.filename})
    return result


@app.get("/api/v1/projects/{project_id}/dorms", response_model=DormRoomsOut)
def get_dorms(project_id: int, session: Session = Depends(get_session)) -> DormRoomsOut:
    get_project_or_404(session, project_id)
    rooms = project_dorm_rooms(session, project_id)
    return DormRoomsOut(rooms=[DormRoomIn(number=room.number, beds=room.beds) for room in rooms])


@app.put("/api/v1/projects/{project_id}/dorms", response_model=DormRoomsOut)
def put_dorms(project_id: int, payload: DormRoomsIn, session: Session = Depends(get_session)) -> DormRoomsOut:
    get_project_or_404(session, project_id)
    rooms = [DormRoom(number=room.number, beds=room.beds) for room in payload.rooms]
    replace_dorm_rooms(session, project_id, rooms)
    log_activity(session, project_id, "dorms", f"保存宿舍名单：{len(rooms)} 个宿舍")
    return DormRoomsOut(rooms=[DormRoomIn(number=room.number, beds=room.beds) for room in rooms])


@app.post("/api/v1/projects/{project_id}/dorms/export-excel", response_model=FileOut)
def export_dorms_excel(project_id: int, payload: ExportDormsRequest, session: Session = Depends(get_session)) -> FileOut:
    get_project_or_404(session, project_id)
    rooms = project_dorm_rooms(session, project_id)
    students = {student.dorm_key: student for student in project_students_core(session, project_id)}
    target = get_settings().exports_dir / str(project_id) / f"宿舍安排表-{uuid.uuid4().hex[:8]}.xlsx"
    export_dorm_roster_to_excel(target, rooms, students, payload.title)
    record = create_file_record(
        session,
        target,
        target.name,
        "dorm_roster",
        project_id,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    log_activity(session, project_id, "dorms", f"导出宿舍安排表：{target.name}")
    return export_file_response(record)


@app.get("/api/v1/projects/{project_id}/dorms/recent", response_model=list[RecentDormRosterOut])
def list_recent_dorm_rosters(project_id: int, session: Session = Depends(get_session)) -> list[RecentDormRosterOut]:
    get_project_or_404(session, project_id)
    records = session.exec(
        select(FileRecord)
        .where(FileRecord.project_id == project_id)
        .where(FileRecord.kind.in_(DORM_ROSTER_FILE_KINDS))
        .order_by(FileRecord.created_at.desc())
        .limit(12)
    )
    recent: list[RecentDormRosterOut] = []
    for record in records:
        if absolute_path(record.path).exists():
            recent.append(recent_dorm_roster_response(record))
        if len(recent) >= 6:
            break
    return recent


@app.post("/api/v1/projects/{project_id}/dorms/recent/{file_id}/restore", response_model=ImportDormsOut)
def restore_recent_dorm_roster(project_id: int, file_id: str, session: Session = Depends(get_session)) -> ImportDormsOut:
    get_project_or_404(session, project_id)
    record = session.get(FileRecord, file_id)
    if record is None or record.project_id != project_id or record.kind not in DORM_ROSTER_FILE_KINDS:
        raise HTTPException(status_code=404, detail="宿舍表不存在")
    path = absolute_path(record.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="宿舍表文件已不存在")
    result = import_dorm_rooms_from_path(session, project_id, path)
    log_activity(session, project_id, "dorms", f"从最近宿舍表恢复：{record.filename}", {"matched_count": result.matched_count})
    return result


@app.post("/api/v1/projects/{project_id}/stickers/export-pdf", response_model=FileOut)
def export_stickers(project_id: int, payload: StickerExportRequest, session: Session = Depends(get_session)) -> FileOut:
    get_project_or_404(session, project_id)
    records = project_students(session, project_id)
    if payload.student_ids:
        selected_ids = set(payload.student_ids)
        records = [record for record in records if record.id in selected_ids]
    if not records:
        raise HTTPException(status_code=400, detail="没有可导出的学生")
    if payload.sticker_kind not in {"door", "bed_cabinet"}:
        raise HTTPException(status_code=400, detail="贴纸类型必须是 door 或 bed_cabinet")
    target_name = "宿舍门牌贴" if payload.sticker_kind == "door" else "床柜贴"
    target = get_settings().exports_dir / str(project_id) / f"{target_name}-{uuid.uuid4().hex[:8]}.pdf"
    export_stickers_pdf(target, [student_to_core(record) for record in records], payload.sticker_kind)
    record = register_export(session, target, target.name, project_id, "application/pdf")
    log_activity(session, project_id, "stickers", f"导出{target_name}：{len(records)} 名学生")
    return export_file_response(record)


@app.get("/api/v1/files/{file_id}/download")
def download_file(file_id: str, session: Session = Depends(get_session)) -> FileResponse:
    record = session.get(FileRecord, file_id)
    if record is None:
        raise HTTPException(status_code=404, detail="文件不存在")
    path = absolute_path(record.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已不存在")
    return FileResponse(path, media_type=record.content_type, filename=record.filename)
