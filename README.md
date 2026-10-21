# QX班小助 Web

面向班主任、教务人员和宿舍管理人员的在线工具，用于管理学生资料、制作班级座位表，以及导出宿舍门牌贴和床柜贴。

## 技术栈

- 后端：Python、FastAPI、SQLite、Pillow、openpyxl
- 前端：React、TypeScript、Vite
- 部署：Docker Compose、Nginx

## 主要功能

- 导入和维护学生信息（序号、姓名、籍贯、班级、送生区），下载 Excel 样表；兼容旧四列表格。
- 管理员创建和批量导入普通用户、重置密码、启用或停用账号。普通用户管理自己的班级，管理员可管理全部班级。
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

默认从宿主机 `8080` 端口访问，数据保存在 `/data/qxbanxiaozhu`。可用以下命令查看服务状态：

```bash
docker compose ps
curl http://127.0.0.1:8080/api/v1/health
```

基础镜像默认不包含蓝底抠图依赖。需要在容器中启用时：

```bash
QXBAN_INSTALL_PHOTO_BACKGROUND=1 docker compose up -d --build
```

启用后，模型文件会缓存到数据目录。服务启动后会在后台预热模型；界面会显示预热或就绪状态，蓝底作业会等待预热完成后依次执行。

## 首次登录与账号管理

首次打开网页时设置管理员账号和密码，没有内置默认密码。账号为 3–64 位字母、数字或 `_ . @ -`，密码为 8–128 个字符。已有数据库会自动增加新字段，保留原数据；首次设置的管理员接管历史班级。

管理员进入“账号管理”后，可以：

- 添加普通用户，设置姓名和初始密码。
- 下载账号样表，按“账号、姓名、初始密码”三列填写 `.xlsx` 后导入，每批最多 500 人。有无效行或重复账号时整批不写入，并提示错误行号。
- 重置普通用户密码，或启用、停用账号。重置密码和停用账号会使该用户的已有登录立即失效。

普通用户首次登录或密码被重置后，须修改初始密码才能使用系统。账号密码仅保存带盐的 scrypt 摘要；登录通过 HttpOnly、SameSite Cookie 保持，最长 12 小时。各用户只能操作自己的班级及关联照片、导出文件，管理员可访问全部班级。个人密码可在顶部“修改密码”中更改。

学生信息表第五列为“送生区”，可以在学生表格、宿舍贴预览中修改。学生 Excel、宿舍名单、照片核对报表和两种宿舍贴 PDF 均包含该字段。旧四列表格导入时送生区为空。

## 账号申请与审批

登录页下方点击“添加账号”，在弹窗填写姓名、手机号、密码和确认密码后提交。手机号支持 11 位中国大陆号码，也可以带 `+86` 区号；通过审批后，手机号就是登录账号，使用申请时设置的密码登录。

管理员进入“账号管理 → 账号申请审批”，可查看待审批申请，点击“同意”，或点击“拒绝”并填写原因。可按待审批、已同意、已拒绝和全部筛选，审批结果及处理时间会留存。相同手机号只能有一个待审批申请，已存在账号的手机号不能重复申请；申请被拒绝后可修改信息重新提交。

待审批申请自提交时起满 **24 小时**自动同意，已拒绝的申请不会再自动通过。后端后台每 30 秒检查一次，无需有人打开页面；服务重启后会立即补处理到期申请。登录和管理员打开审批列表时也会即时处理已到期申请。管理员在到期后再操作时，以系统自动同意的结果为准。

申请密码只保存带盐的 scrypt 摘要，审批通过后创建普通用户，不赋予管理员权限。本人设置的申请密码无需再次强制更改；管理员创建或重置的初始密码仍须首次登录修改。

## 当前 Mac 的本地部署

`docker-compose.local.yml` 使用独立命名卷和当前 Mac 已有的基础镜像，不影响其他部署。先构建前端，再启动：

```bash
npm --prefix frontend ci
npm --prefix frontend run build
docker compose -f docker-compose.local.yml up -d --build
```

入口为 `http://127.0.0.1:8080/`，默认向局域网监听 8080。可通过 `QXBAN_BIND_ADDRESS=127.0.0.1` 仅监听本机，或通过 `QXBAN_HTTP_PORT` 更改端口。数据库和照片保存在项目专用 Docker 命名卷中，容器重建不会删除数据。蓝底抠图沿用本机基础镜像配置，默认关闭。

```bash
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs --tail=100
# 停止并保留数据
docker compose -f docker-compose.local.yml down
```

`Dockerfile.local` 基于本机已有的 `qxbanxiaozhu-local-backend:latest` / `qxbanxiaozhu-local-frontend:latest`，并复制本仓库的新代码和前端产物。在其他机器上请使用上文的标准 `docker-compose.yml` 从 Python/Node 基础镜像构建。

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
