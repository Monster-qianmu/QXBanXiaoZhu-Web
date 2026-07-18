# QX班小助 Web

面向班主任、教务人员和宿舍管理人员的在线工具，用于管理学生资料、制作班级座位表，以及导出宿舍门牌贴和床柜贴。

## 技术栈

- 后端：Python、FastAPI、SQLite、Pillow、openpyxl
- 前端：React、TypeScript、Vite
- 部署：Docker Compose、Nginx

## 主要功能

- 导入和维护学生信息，下载 Excel 样表。
- 可视化编辑与导出横向 A4 班级座位表。
- 管理宿舍、床位和学生照片，导出宿舍门牌贴及床柜贴。
- 批量导入照片并按学生信息匹配；支持裁剪、缩放和绑定。
- 将证件照处理为蓝底图片：任务进入串行队列，完成后在最近活动中提示；后台启动时会预热模型，避免首次正式处理额外等待。

## Docker 部署

准备持久化数据目录后启动：

```bash
mkdir -p /data/qxbanxiaozhu
docker compose up -d --build
```

默认从宿主机 `5173` 端口访问，数据保存在 `/data/qxbanxiaozhu`。可用以下命令查看服务状态：

```bash
docker compose ps
curl http://127.0.0.1:5173/api/v1/health
```

基础镜像默认不包含蓝底抠图依赖。需要在容器中启用时：

```bash
QXBAN_INSTALL_PHOTO_BACKGROUND=1 docker compose up -d --build
```

启用后，模型文件会缓存到数据目录。服务启动后会在后台预热模型；界面会显示预热或就绪状态，蓝底作业会等待预热完成后依次执行。

## 本地开发

后端：

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
QXBAN_DATA_DIR="$PWD/backend/.data" QXBAN_DB_PATH="$PWD/backend/.data/qxban.db" \
  .venv/bin/uvicorn backend.app.main:app --reload
```

前端：

```bash
cd frontend
npm install
npm run dev
```

本地前端默认运行在 `http://127.0.0.1:5173`，并将 `/api` 请求代理到后端。

## 测试与构建

```bash
.venv/bin/pytest -q
cd frontend && npm run test -- --run
cd frontend && npm run build
```

## 项目结构

- `backend/`：FastAPI API、数据库和照片作业队列。
- `frontend/`：React 用户界面。
- `qx_core/`：座位表、宿舍贴、Excel、图片和 PDF 的共享业务逻辑。
- `resources/`：在线版使用的学生信息表样表。
- `scripts/build-docker-images.sh`：构建或导出 Docker 镜像。
- `tests/`：后端 API 和业务核心测试。

## 发布注意事项

请勿提交运行数据、模型权重、环境变量、设备地址或任何访问凭据。相关目录和文件已在 `.gitignore` 与 `.dockerignore` 中排除。
