# QX班小助线上迁移计划

> 本文是从桌面端迁移到在线版时的历史规划记录。当前独立 Web 仓库只包含在线服务源码；文中对桌面端 `main.py` 的引用用于说明业务拆分背景，并非当前构建依赖。

## 目标架构

第一版线上版以低资源、易部署为优先目标，部署目标为斐讯 N1。

```text
React/Vite 前端
        |
FastAPI 后端
        |
SQLite + 本地文件目录
```

- 前端：TypeScript + React + Vite，构建后由 Nginx 或 Caddy 提供静态文件服务。
- 后端：Python + FastAPI，保留现有 Python 业务能力，构建 ARM64 Docker 镜像。
- 数据：SQLite 保存结构化数据，本地挂载目录保存上传照片、处理后照片和导出文件。
- 部署：Docker/Compose 分为 `frontend`、`backend` 和持久化 `data` volume。

## 第一版功能范围

优先迁移这些稳定且对资源要求较低的能力：

- 学生信息 Excel 导入、编辑、导出。
- 班级座位表编辑、保存和横向 A4 PDF 导出。
- 宿舍名单导入、编辑、保存和导出。
- 宿舍门牌贴、床柜贴 PDF 批量导出。
- 上传照片并按学生姓名绑定。

暂缓或降级这些高资源能力：

- `rembg` + `onnxruntime` 蓝底抠图不作为第一版核心同步功能。
- 如需上线，放入后台异步任务，单机并发限制为 1。
- 前端应把照片蓝底处理显示为可选能力，并提示处理耗时。

## 后端拆分顺序

当前核心逻辑集中在 `main.py`，迁移前先拆成可测试的纯业务模块：

```text
backend/
  app/
    main.py              # FastAPI 入口
    core/
      students.py        # Student 模型、姓名规范化、学生字段更新
      excel_io.py        # Excel 读取/导出
      dorms.py           # DormRoom、宿舍名单读取/匹配/保存
      seats.py           # 座位布局、A4 横向比例、移动/重置/撤销重做状态
      stickers.py        # 宿舍门牌贴、床柜贴布局
      photos.py          # 照片匹配、绑定、可选蓝底处理
      pdf_export.py      # PDF 导出适配层
    db/
      database.py        # SQLite 连接、迁移初始化
      models.py          # 表结构或 ORM 模型
    files.py             # 上传、导出、临时文件路径管理
```

拆分原则：

- 先让 PyQt UI 和 FastAPI 共用业务模块，再逐步替换界面。
- Excel、PDF、照片处理函数不要依赖 Qt 控件。
- 与 A4 纸张、宿舍贴头像比例相关的常量必须集中定义，避免前后端导出结果不一致。
- 每拆出一个模块，补最小单元测试，至少覆盖 Excel 导入、宿舍匹配和 PDF 数据结构生成。

## API 草案

第一版可以从这些接口开始：

```text
POST   /api/projects
GET    /api/projects
GET    /api/projects/{project_id}

POST   /api/projects/{project_id}/students/import-excel
GET    /api/projects/{project_id}/students
PATCH  /api/projects/{project_id}/students/{student_id}
POST   /api/projects/{project_id}/students/export-excel

POST   /api/projects/{project_id}/photos/upload
POST   /api/projects/{project_id}/students/{student_id}/photo

GET    /api/projects/{project_id}/seats
PUT    /api/projects/{project_id}/seats
POST   /api/projects/{project_id}/seats/export-pdf

POST   /api/projects/{project_id}/dorms/import-excel
GET    /api/projects/{project_id}/dorms
PUT    /api/projects/{project_id}/dorms
POST   /api/projects/{project_id}/dorms/export-excel

POST   /api/projects/{project_id}/stickers/export-pdf
```

## 前端页面

前端保持工具型应用体验，不做营销落地页。首屏进入可操作工作台。

- 数据导入：Excel 上传、学生表格、照片目录上传/匹配结果。
- 座位表：横向 A4 画布预览、座位拖拽、重置、撤销、重做、四向移动、PDF 导出。
- 宿舍名单：最近宿舍表、宿舍房间、床位增删、学生姓名/籍贯编辑。
- 宿舍贴：门牌贴和床柜贴预览、勾选、批量导出。
- 照片处理：第一版可隐藏为可选页或后台任务入口。

座位表和贴纸预览可优先选 Canvas/SVG/Konva/Fabric.js。无论选哪种方案，导出 PDF 的最终排版都以后端为准，前端只负责预览和编辑状态。

## 数据目录建议

N1 上挂载一个持久化目录，例如 `/data/qxbanxiaozhu`：

```text
/data/qxbanxiaozhu/
  qxban.db
  uploads/
  photos/
  exports/
  temp/
  logs/
```

后端容器内统一映射为 `/app/data`。所有路径通过环境变量配置，默认值适合 Docker：

```text
QXBAN_DATA_DIR=/app/data
QXBAN_DB_PATH=/app/data/qxban.db
QXBAN_PHOTO_TASK_CONCURRENCY=1
```

## N1 部署注意事项

- 镜像必须支持 ARM64。
- SQLite 数据库和文件目录必须挂载到 N1 磁盘，不要只放在容器层。
- `rembg`、`onnxruntime`、OpenCV、SciPy 相关依赖会明显增加镜像体积和运行内存。
- 照片蓝底处理如保留，应拆成独立 extra 或单独 worker，避免拖慢常规 Excel/PDF 功能。
- PDF 导出如果从 Qt 绘制迁移到服务端，应优先验证中文字体、A4 尺寸、横向比例和图片嵌入效果。

## 推荐里程碑

1. 拆 `main.py` 核心业务模块，保持桌面版可运行。
2. 建 FastAPI 后端骨架，引入 SQLite 和本地文件目录。
3. 迁移学生 Excel 导入/导出与宿舍名单 API。
4. 迁移座位表状态保存和 PDF 导出。
5. 建 React/Vite 前端，先完成数据导入、学生表格和宿舍名单。
6. 完成座位表画布与宿舍贴预览。
7. 补 Dockerfile、Compose、N1 数据挂载说明。
8. 评估照片蓝底处理是否作为异步任务上线。

## 2026-06-22 实施进展

已完成第一版线上化骨架：

- 新增 `qx_core/` 共享业务包，包含学生/宿舍数据模型、Excel 读写、照片匹配、座位表状态、宿舍贴排版和 ReportLab PDF 导出。
- `main.py` 已改为复用 `qx_core` 中的学生、宿舍、Excel 和照片匹配基础能力，桌面版仍保留原 PyQt 界面与 Qt PDF 导出。
- 新增 `backend/` FastAPI 服务，API 前缀为 `/api/v1`，使用 SQLModel + SQLite，本地文件目录保存上传、照片和导出文件。
- 新增 `frontend/` React/Vite 工作台，包含数据导入、座位表、宿舍名单、宿舍贴和照片管理页面。
- 新增 `docker-compose.yml`、`backend/Dockerfile`、`frontend/Dockerfile` 和 Nginx 反代配置；N1 默认挂载 `/data/qxbanxiaozhu:/app/data`。
- 新增 `tests/`，覆盖核心 Excel/宿舍/照片/PDF 和 FastAPI 主流程。

本地开发命令：

```bash
# 后端
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
QXBAN_DATA_DIR="$PWD/backend/.data" \
QXBAN_DB_PATH="$PWD/backend/.data/qxban.db" \
.venv/bin/uvicorn backend.app.main:app --reload

# 前端
cd frontend
npm install
npm run dev
```

验证命令：

```bash
.venv/bin/pytest -q
cd frontend && npm run build && npm audit
```

N1 部署命令：

```bash
mkdir -p /data/qxbanxiaozhu
docker compose up -d --build
```

当前线上版仍按单用户局域网使用设计，未加入账号登录。若暴露到公网，必须先补认证、访问控制和反向代理 HTTPS。蓝底抠图仍默认关闭，基础镜像不安装 `rembg` 和 `onnxruntime`。

## 2026-07-10 收口状态

第一版线上版核心功能已覆盖当前桌面版低资源迁移范围：

- 数据导入：学生样表下载、Excel 导入、学生增删改、逐学生照片上传、更新后的学生表导出。
- 座位表：横向 A4 画布、标题编辑、行列调整、座位拖拽/增删/改名、排标注、宽度缩放、整表四向移动、撤销/重做、自动保存、重置和 PDF 导出。
- 宿舍名单：宿舍 Excel 读取、宿舍/床位增删改、学生安排、拖拽换床、未安排学生池、最近宿舍表恢复、保存和 Excel 导出。
- 宿舍贴：门牌贴和床柜贴预览、学生勾选、贴纸内编辑姓名/籍贯/班级、照片替换和 PDF 导出。
- 照片管理：单张裁剪绑定、批量文件/文件夹导入、姓名/序号辅助匹配、未匹配缩略图人工绑定、绑定全部建议、清除照片、缺照片检查、导入核对清单、状态清单和已绑定照片 ZIP 导出。
- 部署：FastAPI + SQLite + 本地文件目录，React/Vite 前端，Docker Compose 面向 N1 持久化 `/data/qxbanxiaozhu`。

当前仍保留为明确的非第一版默认能力：

- `rembg` + `onnxruntime` 人像抠图换蓝底：N1 资源占用过高，基础镜像默认关闭；如后续需要，应作为 extra 或独立 worker 启用，并限制单机并发为 1。
- 账号登录、权限控制和 HTTPS：当前定位为单用户局域网工具；公网开放前必须补齐。
- 前端包体积拆分：生产构建通过，但 Vite 提示单个 chunk 超过 500 kB，可在后续用动态导入优化。

收口验证：

```bash
.venv/bin/pytest -q
cd frontend && npm run test -- --run
cd frontend && npm run build
```

本轮结果为后端 10 个测试通过、前端 26 个测试通过、生产构建通过。真实样本回归结果为 22 张照片中 21 张自动精确匹配，`06_.jpg` 未匹配但建议 06 号同学，文件序号缺口为 `02`、`04`、`18`，照片清单和照片包导出均通过。
