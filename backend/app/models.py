from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class ProjectRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    owner_id: int | None = Field(default=None, index=True, foreign_key="userrecord.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StudentRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(index=True, foreign_key="projectrecord.id")
    student_index: int
    name: str
    hometown: str = ""
    source_area: str = ""
    class_name: str = ""
    photo_path: str = ""
    photo_match_status: str = "unmatched"


class DormRoomRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(index=True, foreign_key="projectrecord.id")
    room_order: int = 0
    number: str
    beds: list[str | None] = Field(default_factory=list, sa_column=Column(JSON))


class SeatLayoutRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(index=True, foreign_key="projectrecord.id", unique=True)
    layout: dict = Field(default_factory=dict, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FileRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    project_id: int | None = Field(default=None, index=True, foreign_key="projectrecord.id")
    kind: str = Field(index=True)
    path: str
    filename: str
    content_type: str = "application/octet-stream"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ActivityRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    project_id: int | None = Field(default=None, index=True, foreign_key="projectrecord.id")
    kind: str = Field(index=True)
    message: str
    level: str = "info"
    detail: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PhotoBackgroundJobRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    project_id: int = Field(index=True, foreign_key="projectrecord.id")
    student_id: int = Field(index=True, foreign_key="studentrecord.id")
    input_file_id: str = Field(foreign_key="filerecord.id")
    status: str = Field(default="queued", index=True)
    result_file_id: str | None = Field(default=None, foreign_key="filerecord.id")
    error_message: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: datetime | None = None
    completed_at: datetime | None = None


class UserRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    display_name: str = ""
    password_hash: str
    role: str = "user"
    is_active: bool = True
    must_change_password: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LoginSessionRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    user_id: int = Field(index=True, foreign_key="userrecord.id")
    expires_at: datetime
