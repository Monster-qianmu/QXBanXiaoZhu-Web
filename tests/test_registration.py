import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from tests.test_accounts import isolated_app, setup


@pytest.fixture(autouse=True)
def clear_limits():
    from backend.app.auth import _attempts
    from backend.app.registration_routes import _submission_attempts
    _attempts.clear()
    _submission_attempts.clear()
    yield
    _attempts.clear()
    _submission_attempts.clear()


def apply(client, phone='13900000001', **changes):
    payload = {'name': '申请老师', 'phone': phone, 'password': 'ApplicationPass2026!', 'confirm_password': 'ApplicationPass2026!'}
    payload.update(changes)
    return client.post('/api/v1/auth/registration-requests', json=payload)


def deadline(application):
    return datetime.fromisoformat(application['auto_approve_at'].removesuffix('Z'))


def make_due(application_id):
    from backend.app.db import get_engine
    from backend.app.models import RegistrationRequestRecord
    from backend.app.registration import utc_now
    with Session(get_engine()) as session:
        item = session.get(RegistrationRequestRecord, application_id)
        item.auto_approve_at = utc_now() - timedelta(seconds=1)
        session.add(item)
        session.commit()


def test_public_application_validation_and_pending_login(tmp_path, monkeypatch):
    with isolated_app(tmp_path, monkeypatch) as (client, app):
        setup(client)
        with TestClient(app) as public:
            assert apply(public, name='  ').status_code == 400
            assert apply(public, phone='12345').status_code == 400
            assert apply(public, phone='１３９０００００００１').status_code == 400
            assert apply(public, confirm_password='DifferentPass2026!').status_code == 400
            assert apply(public, password='short', confirm_password='short').status_code == 400
            assert apply(public, role='admin').status_code == 422
            result = apply(public, phone='+86 139-0000-0001')
            assert result.status_code == 201, result.text
            item = result.json()
            assert item['status'] == 'pending' and item['phone'] == '13900000001'
            assert 'password' not in result.text and 'scrypt' not in result.text
            submitted = datetime.fromisoformat(item['submitted_at'].removesuffix('Z'))
            assert deadline(item) - submitted == timedelta(hours=24)
            assert apply(public).status_code == 409
            assert public.get('/api/v1/admin/registration-requests').status_code == 401
            assert public.post('/api/v1/auth/login', json={'username': item['phone'], 'password': 'WrongPassword2026!'}).status_code == 401
            pending = public.post('/api/v1/auth/login', json={'username': '+86 139-0000-0001', 'password': 'ApplicationPass2026!'})
            assert pending.status_code == 403 and '等待' in pending.json()['detail']
        from backend.app.db import get_engine
        from backend.app.models import RegistrationRequestRecord, UserRecord
        from backend.app.auth import verify_password
        with Session(get_engine()) as session:
            record = session.get(RegistrationRequestRecord, item['id'])
            assert record.password_hash.startswith('scrypt$')
            assert verify_password('ApplicationPass2026!', record.password_hash)
            assert not session.exec(select(UserRecord).where(UserRecord.username == item['phone'])).first()
        listing = client.get('/api/v1/admin/registration-requests')
        assert listing.status_code == 200
        assert 'password' not in listing.text and 'scrypt' not in listing.text


def test_manual_approval_creates_ordinary_account(tmp_path, monkeypatch):
    with isolated_app(tmp_path, monkeypatch) as (admin, app):
        setup(admin)
        application = apply(admin).json()
        result = admin.post(f"/api/v1/admin/registration-requests/{application['id']}/review", json={'decision': 'approve'})
        assert result.status_code == 200, result.text
        approved = result.json()
        assert approved['status'] == 'approved' and approved['reviewed_by'] is not None
        assert approved['review_note'] == '管理员同意申请'
        assert admin.post(f"/api/v1/admin/registration-requests/{application['id']}/review", json={'decision': 'approve'}).status_code == 409
        with TestClient(app) as user:
            result = user.post('/api/v1/auth/login', json={'username': application['phone'], 'password': 'ApplicationPass2026!'})
            assert result.status_code == 200, result.text
            assert result.json()['role'] == 'user'
            assert result.json()['phone'] == application['phone']
            assert result.json()['display_name'] == '申请老师'
            assert result.json()['must_change_password'] is False
            assert user.get('/api/v1/projects').status_code == 200
            assert user.get('/api/v1/admin/registration-requests').status_code == 403
            assert user.post(f"/api/v1/admin/registration-requests/{application['id']}/review", json={'decision': 'reject'}).status_code == 403
        assert apply(admin).status_code == 409


def test_rejected_application_stays_rejected_and_can_reapply(tmp_path, monkeypatch):
    with isolated_app(tmp_path, monkeypatch) as (admin, app):
        setup(admin)
        item = apply(admin).json()
        result = admin.post(f"/api/v1/admin/registration-requests/{item['id']}/review", json={'decision': 'reject', 'note': '请补充真实姓名'})
        assert result.status_code == 200 and result.json()['status'] == 'rejected'
        from backend.app.registration import approve_due_registrations
        assert approve_due_registrations(deadline(item) + timedelta(days=2)) == 0
        with TestClient(app) as user:
            result = user.post('/api/v1/auth/login', json={'username': item['phone'], 'password': 'ApplicationPass2026!'})
            assert result.status_code == 403
            assert '请补充真实姓名' in result.json()['detail']
        new_application = apply(admin, name='补充姓名')
        assert new_application.status_code == 201
        assert new_application.json()['id'] != item['id']


def test_exact_24_hour_boundary_and_concurrent_automatic_approval(tmp_path, monkeypatch):
    with isolated_app(tmp_path, monkeypatch) as (admin, app):
        setup(admin)
        item = apply(admin).json()
        from backend.app.registration import approve_due_registrations
        # Stored timestamps retain sub-second precision; check the exact DB deadline.
        from backend.app.db import get_engine
        from backend.app.models import RegistrationRequestRecord, UserRecord
        with Session(get_engine()) as session:
            expires = session.get(RegistrationRequestRecord, item['id']).auto_approve_at
        assert approve_due_registrations(expires - timedelta(microseconds=1)) == 0
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(approve_due_registrations, [expires, expires]))
        assert sum(results) == 1
        assert approve_due_registrations(expires + timedelta(hours=1)) == 0
        with Session(get_engine()) as session:
            users = list(session.exec(select(UserRecord).where(UserRecord.username == item['phone'])))
            assert len(users) == 1
            record = session.get(RegistrationRequestRecord, item['id'])
            assert record.status == 'approved' and record.reviewed_by is None
            assert '自动' in record.review_note
        with TestClient(app) as user:
            assert user.post('/api/v1/auth/login', json={'username': item['phone'], 'password': 'ApplicationPass2026!'}).status_code == 200


def test_overdue_login_and_late_rejection(tmp_path, monkeypatch):
    with isolated_app(tmp_path, monkeypatch) as (admin, app):
        setup(admin)
        item = apply(admin).json()
        make_due(item['id'])
        result = admin.post(f"/api/v1/admin/registration-requests/{item['id']}/review", json={'decision': 'reject'})
        assert result.status_code == 409
        assert admin.get('/api/v1/admin/registration-requests').json()[0]['status'] == 'approved'
        other = apply(admin, phone='13900000002').json()
        make_due(other['id'])
        with TestClient(app) as user:
            result = user.post('/api/v1/auth/login', json={'username': other['phone'], 'password': 'ApplicationPass2026!'})
            assert result.status_code == 200


def test_worker_catches_up_and_approves_without_any_http_requests(tmp_path, monkeypatch):
    with isolated_app(tmp_path, monkeypatch) as (admin, _app):
        setup(admin)
        catchup = apply(admin).json()
        waiting = apply(admin, phone='13900000002').json()
        make_due(catchup['id'])
        from backend.app import registration
        from backend.app.db import get_engine
        from backend.app.models import RegistrationRequestRecord
        with Session(get_engine()) as session:
            row = session.get(RegistrationRequestRecord, waiting['id'])
            row.auto_approve_at = registration.utc_now() + timedelta(milliseconds=250)
            session.add(row)
            session.commit()
        monkeypatch.setattr(registration, 'APPROVAL_POLL_SECONDS', 0.03)
        try:
            registration.start_registration_worker()
            with Session(get_engine()) as session:
                assert session.get(RegistrationRequestRecord, catchup['id']).status == 'approved'
            timeout = time.monotonic() + 3
            approved = False
            while time.monotonic() < timeout:
                with Session(get_engine()) as session:
                    approved = session.get(RegistrationRequestRecord, waiting['id']).status == 'approved'
                if approved:
                    break
                time.sleep(0.03)
            assert approved
        finally:
            registration.stop_registration_worker()


def test_existing_account_is_never_overwritten_by_an_application(tmp_path, monkeypatch):
    with isolated_app(tmp_path, monkeypatch) as (admin, _app):
        setup(admin)
        item = apply(admin).json()
        # An administrator creates an account with the same login while review is pending.
        account = admin.post('/api/v1/admin/users', json={'username': item['phone'], 'password': 'ExistingAccount2026!'}).json()
        make_due(item['id'])
        from backend.app.registration import approve_due_registrations
        assert approve_due_registrations() == 0
        from backend.app.db import get_engine
        from backend.app.models import RegistrationRequestRecord, UserRecord
        from backend.app.auth import verify_password
        with Session(get_engine()) as session:
            assert session.get(RegistrationRequestRecord, item['id']).status == 'rejected'
            assert verify_password('ExistingAccount2026!', session.get(UserRecord, account['id']).password_hash)
        assert apply(admin).status_code == 409


def test_existing_user_database_adds_phone_without_losing_accounts(tmp_path, monkeypatch):
    from backend.app.auth import hash_password
    with sqlite3.connect(tmp_path / 'qxban.db') as db:
        db.executescript('''
          CREATE TABLE userrecord (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL, role TEXT NOT NULL, is_active BOOLEAN NOT NULL,
            must_change_password BOOLEAN NOT NULL, created_at DATETIME NOT NULL);
        ''')
        db.execute('INSERT INTO userrecord VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                   (1, 'legacy-admin', '历史管理员', hash_password('LegacyAccount2026!'), 'admin', 1, 0, '2026-01-01 00:00:00'))
    with isolated_app(tmp_path, monkeypatch) as (admin, _app):
        result = admin.post('/api/v1/auth/login', json={'username': 'legacy-admin', 'password': 'LegacyAccount2026!'})
        assert result.status_code == 200, result.text
        assert result.json()['phone'] is None
        item = apply(admin).json()
        result = admin.post(f"/api/v1/admin/registration-requests/{item['id']}/review", json={'decision': 'approve'})
        assert result.status_code == 200
        with sqlite3.connect(tmp_path / 'qxban.db') as db:
            assert db.execute('select count(*) from userrecord').fetchone()[0] == 2
            assert db.execute('pragma integrity_check').fetchone()[0] == 'ok'
