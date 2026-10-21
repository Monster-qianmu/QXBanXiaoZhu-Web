from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from .auth import admin_user, hash_password, validate_password
from .db import get_session
from .models import RegistrationRequestRecord, UserRecord
from .registration import APPROVAL_DELAY, account_for_phone, approve_due_registrations, approve_registration, normalize_phone, registration_out, utc_now

router = APIRouter(prefix="/api/v1")
_submission_attempts: dict[str, deque] = defaultdict(deque)
_submission_lock = threading.Lock()


class RegistrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    confirm_password: str = Field(min_length=1, max_length=128)


class RegistrationReview(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = Field(default="", max_length=300)


def check_submission_rate(request: Request) -> None:
    key = request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
    with _submission_lock:
        now = time.monotonic()
        # Remove old keys so the public endpoint cannot grow this cache indefinitely.
        for old_key in list(_submission_attempts):
            queue = _submission_attempts[old_key]
            while queue and queue[0] < now - 3600:
                queue.popleft()
            if not queue:
                del _submission_attempts[old_key]
        attempts = _submission_attempts[key]
        if len(attempts) >= 20:
            raise HTTPException(429, "申请提交过于频繁，请稍后再试")
        attempts.append(now)


@router.post("/auth/registration-requests", status_code=201)
def submit_registration(payload: RegistrationCreate, request: Request, session: Session = Depends(get_session)):
    check_submission_rate(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "请填写姓名")
    try:
        phone = normalize_phone(payload.phone)
    except ValueError as error:
        raise HTTPException(400, str(error))
    validate_password(payload.password)
    if payload.password != payload.confirm_password:
        raise HTTPException(400, "两次密码不一致")
    password_hash = hash_password(payload.password)
    now = utc_now()
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    if account_for_phone(session, phone) is not None:
        session.rollback()
        raise HTTPException(409, "该手机号已有账号，请直接登录或联系管理员重置密码")
    pending = session.exec(select(RegistrationRequestRecord).where(
        RegistrationRequestRecord.phone == phone, RegistrationRequestRecord.status == "pending"
    )).first()
    if pending is not None:
        session.rollback()
        raise HTTPException(409, "该手机号已有待审批申请，请勿重复提交")
    record = RegistrationRequestRecord(name=name, phone=phone, password_hash=password_hash,
                                       submitted_at=now, auto_approve_at=now + APPROVAL_DELAY)
    session.add(record)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "该手机号已有账号或待审批申请，请勿重复提交")
    session.refresh(record)
    return registration_out(record)


@router.get("/admin/registration-requests")
def list_registration_requests(_admin: UserRecord = Depends(admin_user), session: Session = Depends(get_session)):
    approve_due_registrations()
    return [registration_out(record) for record in session.exec(
        select(RegistrationRequestRecord).order_by(RegistrationRequestRecord.submitted_at.desc(), RegistrationRequestRecord.id.desc())
    )]


@router.post("/admin/registration-requests/{application_id}/review")
def review_registration(application_id: int, payload: RegistrationReview,
                        admin: UserRecord = Depends(admin_user), session: Session = Depends(get_session)):
    # Authentication has already opened a read transaction; end it before taking the write lock.
    admin_id = admin.id
    session.rollback()
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    record = session.get(RegistrationRequestRecord, application_id)
    if record is None:
        session.rollback()
        raise HTTPException(404, "账号申请不存在")
    if record.status != "pending":
        session.rollback()
        raise HTTPException(409, "该申请已处理，请刷新列表")
    now = utc_now()
    if record.auto_approve_at <= now:
        approve_registration(session, record, now)
        session.commit()
        session.refresh(record)
        if payload.decision == "reject" or record.status != "approved":
            raise HTTPException(409, "该申请已到期处理，请刷新列表查看结果")
        return registration_out(record)
    if payload.decision == "approve":
        approved = approve_registration(session, record, now, admin_id, payload.note.strip())
        session.commit()
        session.refresh(record)
        if not approved:
            raise HTTPException(409, "手机号已有账号，申请已拒绝，请刷新列表")
    else:
        record.status = "rejected"
        record.reviewed_at = now
        record.reviewed_by = admin_id
        record.review_note = payload.note.strip() or "管理员未同意该申请"
        session.add(record)
        session.commit()
        session.refresh(record)
    return registration_out(record)
