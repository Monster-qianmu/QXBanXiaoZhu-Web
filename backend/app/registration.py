from __future__ import annotations

import logging
import re
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlmodel import Session, select

from .db import get_engine
from .models import RegistrationRequestRecord, UserRecord

APPROVAL_DELAY = timedelta(hours=24)
APPROVAL_POLL_SECONDS = 30
_worker: threading.Thread | None = None
_stop_event = threading.Event()
_worker_lock = threading.Lock()
logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    # Existing SQLite timestamps are naive UTC; API responses explicitly include Z.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_phone(value: str) -> str:
    phone = re.sub(r"[\s-]+", "", value)
    if phone.startswith("+86"):
        phone = phone[3:]
    if not re.fullmatch(r"1[3-9]\d{9}", phone, flags=re.ASCII):
        raise ValueError("请输入有效的 11 位手机号")
    return phone


def account_for_phone(session: Session, phone: str) -> UserRecord | None:
    return session.exec(select(UserRecord).where(or_(UserRecord.username == phone, UserRecord.phone == phone))).first()


def timestamp(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") + "Z" if value else None


def registration_out(record: RegistrationRequestRecord) -> dict:
    return {
        "id": record.id,
        "name": record.name,
        "phone": record.phone,
        "status": record.status,
        "submitted_at": timestamp(record.submitted_at),
        "auto_approve_at": timestamp(record.auto_approve_at),
        "reviewed_at": timestamp(record.reviewed_at),
        "reviewed_by": record.reviewed_by,
        "review_note": record.review_note,
        "user_id": record.user_id,
    }


def approve_registration(session: Session, record: RegistrationRequestRecord, now: datetime, reviewer_id: int | None = None, note: str = "") -> bool:
    """Caller holds a SQLite write lock; user creation and decision commit together."""
    if record.status != "pending":
        return False
    if account_for_phone(session, record.phone) is not None:
        record.status = "rejected"
        record.review_note = "手机号已被现有账号使用，请联系管理员"
        record.reviewed_at = now
        record.reviewed_by = reviewer_id
        session.add(record)
        return False
    user = UserRecord(
        username=record.phone,
        phone=record.phone,
        display_name=record.name,
        password_hash=record.password_hash,
        role="user",
        is_active=True,
        must_change_password=False,
        created_at=now,
    )
    session.add(user)
    session.flush()
    record.status = "approved"
    record.user_id = user.id
    record.reviewed_by = reviewer_id
    record.reviewed_at = now
    record.review_note = (note or "管理员同意申请") if reviewer_id is not None else "满 24 小时未审批，系统自动同意"
    session.add(record)
    return True


def approve_due_registrations(now: datetime | None = None) -> int:
    now = now or utc_now()
    with Session(get_engine()) as session:
        # Serialize manual review, automatic review and submissions across processes.
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        due = list(session.exec(select(RegistrationRequestRecord).where(
            RegistrationRequestRecord.status == "pending",
            RegistrationRequestRecord.auto_approve_at <= now,
        ).order_by(RegistrationRequestRecord.id)))
        count = sum(approve_registration(session, record, now) for record in due)
        session.commit()
        return count


def _worker_loop() -> None:
    while not _stop_event.is_set():
        try:
            approve_due_registrations()
        except Exception:
            # Do not log application fields, phone numbers or password digests.
            logger.error("账号申请自动审批检查失败，将在下次轮询重试")
        _stop_event.wait(APPROVAL_POLL_SECONDS)


def start_registration_worker() -> None:
    global _worker
    with _worker_lock:
        if _worker is not None and _worker.is_alive():
            return
        # Catch up on requests that expired while the service was stopped.
        approve_due_registrations()
        _stop_event.clear()
        _worker = threading.Thread(target=_worker_loop, name="qxban-registration-approval", daemon=True)
        _worker.start()


def stop_registration_worker() -> None:
    global _worker
    with _worker_lock:
        _stop_event.set()
        if _worker is not None:
            _worker.join(timeout=5)
            if not _worker.is_alive():
                _worker = None
