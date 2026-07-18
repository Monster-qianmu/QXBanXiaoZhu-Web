FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    QXBAN_DATA_DIR=/app/data

WORKDIR /app

ARG INSTALL_PHOTO_BACKGROUND=0

COPY backend/requirements*.txt /app/backend/
RUN pip install --no-cache-dir -r /app/backend/requirements.txt \
    && if [ "$INSTALL_PHOTO_BACKGROUND" = "1" ]; then \
        pip install --no-cache-dir -r /app/backend/requirements-blue.txt; \
    fi

COPY qx_core /app/qx_core
COPY backend /app/backend
COPY resources /app/resources

EXPOSE 8000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
