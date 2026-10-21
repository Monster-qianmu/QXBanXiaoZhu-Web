from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = "新班级项目"


class ProjectPatch(BaseModel):
    name: str | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    created_at: datetime


class ActivityOut(BaseModel):
    id: str
    project_id: int | None = None
    kind: str
    message: str
    level: str
    detail: dict = Field(default_factory=dict)
    created_at: datetime


class StudentOut(BaseModel):
    id: int
    index: int
    name: str
    hometown: str
    source_area: str = ""
    class_name: str
    photo_match_status: str
    photo_url: str | None = None


class StudentCreate(BaseModel):
    name: str
    hometown: str = ""
    source_area: str = ""
    class_name: str = ""


class StudentPatch(BaseModel):
    name: str | None = None
    hometown: str | None = None
    source_area: str | None = None
    class_name: str | None = None


class ImportStudentsOut(BaseModel):
    imported_count: int
    students: list[StudentOut]


class FileOut(BaseModel):
    file_id: str
    filename: str
    download_url: str


class PhotoBackgroundJobOut(BaseModel):
    id: str
    status: str
    queue_ahead_count: int = 0
    student_id: int
    student_name: str
    filename: str
    result: FileOut | None = None
    error_message: str = ""
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class RecentDormRosterOut(BaseModel):
    file_id: str
    filename: str
    download_url: str
    created_at: datetime


class AttachPhotoRequest(BaseModel):
    file_id: str


class PhotoImportItemOut(BaseModel):
    filename: str
    status: str
    message: str
    image_width: int | None = None
    image_height: int | None = None
    image_format: str | None = None
    student_id: int | None = None
    student_name: str | None = None
    sequence_number: int | None = None
    suggested_student_id: int | None = None
    suggested_student_name: str | None = None
    suggested_student_index: int | None = None
    file_id: str | None = None
    download_url: str | None = None


class PhotoSequenceGapStudentOut(BaseModel):
    index: int
    student_id: int
    name: str
    photo_bound: bool
    photo_match_status: str


class PhotoImportOut(BaseModel):
    matched_count: int
    unmatched_count: int
    sequence_numbers: list[int] = Field(default_factory=list)
    missing_sequence_numbers: list[int] = Field(default_factory=list)
    sequence_gap_students: list[PhotoSequenceGapStudentOut] = Field(default_factory=list)
    report_file_id: str | None = None
    report_filename: str | None = None
    report_download_url: str | None = None
    results: list[PhotoImportItemOut]


class SeatLayoutIn(BaseModel):
    layout: dict


class SeatLayoutOut(BaseModel):
    layout: dict


class DormRoomIn(BaseModel):
    number: str
    beds: list[str | None] = Field(default_factory=list)


class DormRoomsIn(BaseModel):
    rooms: list[DormRoomIn] = Field(default_factory=list)


class DormRoomsOut(BaseModel):
    rooms: list[DormRoomIn]


class ImportDormsOut(BaseModel):
    room_count: int
    matched_count: int
    rooms: list[DormRoomIn]


class ExportDormsRequest(BaseModel):
    title: str = "宿舍安排表"


class StickerExportRequest(BaseModel):
    student_ids: list[int] | None = None
    sticker_kind: str = "door"
