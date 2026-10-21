from contextlib import contextmanager
from unittest.mock import patch
from fastapi.testclient import TestClient


@contextmanager
def authenticated_client(app):
    with patch("backend.app.main.start_registration_worker"), patch("backend.app.main.stop_registration_worker"), TestClient(app) as client:
        result = client.post('/api/v1/auth/setup', json={'username': 'test-admin', 'password': 'TestAdminPassword!2026'})
        assert result.status_code == 200, result.text
        yield client
