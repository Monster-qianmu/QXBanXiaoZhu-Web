from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    db_path: Path
    photo_task_concurrency: int = 1
    photo_background_enabled: bool = True
    photo_background_prewarm_enabled: bool = True

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def photos_dir(self) -> Path:
        return self.data_dir / "photos"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def temp_dir(self) -> Path:
        return self.data_dir / "temp"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def rembg_models_dir(self) -> Path:
        return self.data_dir / "rembg_models"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    data_dir = Path(os.environ.get("QXBAN_DATA_DIR", "/app/data")).expanduser()
    db_path = Path(os.environ.get("QXBAN_DB_PATH", str(data_dir / "qxban.db"))).expanduser()
    try:
        concurrency = int(os.environ.get("QXBAN_PHOTO_TASK_CONCURRENCY", "1"))
    except ValueError:
        concurrency = 1
    background_enabled_value = os.environ.get("QXBAN_PHOTO_BACKGROUND_ENABLED", "1").strip().lower()
    background_enabled = background_enabled_value not in {"0", "false", "off", "no", "disabled"}
    prewarm_enabled_value = os.environ.get("QXBAN_PHOTO_BACKGROUND_PREWARM_ENABLED", "1").strip().lower()
    prewarm_enabled = prewarm_enabled_value not in {"0", "false", "off", "no", "disabled"}
    return Settings(
        data_dir=data_dir,
        db_path=db_path,
        photo_task_concurrency=max(1, concurrency),
        photo_background_enabled=background_enabled,
        photo_background_prewarm_enabled=prewarm_enabled,
    )


def ensure_data_dirs(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    for path in (
        settings.data_dir,
        settings.uploads_dir,
        settings.photos_dir,
        settings.exports_dir,
        settings.temp_dir,
        settings.logs_dir,
        settings.rembg_models_dir,
        settings.db_path.parent,
    ):
        path.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("U2NET_HOME", str(settings.rembg_models_dir))
