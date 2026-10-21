from contextlib import contextmanager
from fastapi.testclient import TestClient


@contextmanager
def authenticated_client(app):
    with TestClient(app) as client:
        result = client.post('/api/v1/auth/setup', json={'username': 'test-admin', 'password': 'TestAdminPassword!2026'})
        assert result.status_code == 200, result.text
        yield client
