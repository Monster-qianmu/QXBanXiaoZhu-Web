# QX班小助 项目信息

## 独立 Web 仓库

- 本目录是 `QXBanXiaoZhu-Web` 的独立公开仓库，用于在线版的开发与 Docker 部署；它不关联原桌面客户端仓库的 Git 历史或远程地址。
- Web 服务由 `backend/`（FastAPI）与 `frontend/`（React/Vite）组成，`qx_core/` 保留为共享的 Python 业务核心；桌面端兼容文件仅作为迁移期间的参考和复用来源。
- 发布前不得提交 `backend/.data/`、模型权重、环境变量文件、开发日志、设备地址或访问凭据。镜像构建与部署采用 `docker-compose.yml`。

## 项目概览

- 这是一个 Python + React 在线应用，后端入口为 `backend/app/main.py`，前端入口为 `frontend/src/main.tsx`。
- 主要功能包括学生信息导入、班级座位表、宿舍名字贴、宿舍名单与照片处理。
- 用户界面和提示文字以中文为主，生产环境通过 Docker Compose 运行。

## 历史桌面端迁移备忘

- 以下桌面端相关条目保留为业务规则和迁移背景参考；本独立 Web 仓库不包含 `main.py`、PyQt、PyInstaller 或桌面安装包构建文件。
- 实现在线功能时以 `backend/`、`frontend/` 与 `qx_core/` 的现有代码为准，不要重新引入桌面端依赖。

## 当前结构

- `main.py`：核心应用代码，包含数据模型、页面组件、导入导出和窗口逻辑。
- `resources/`：示例表格、PDF 和应用图标等资源；轻量安装包不内置 rembg 模型。
- `docs/`、`dist/`：说明文档与打包产物，其中 `dist/QXBanXiaoZhu-Win10-Stable.zip` 是给其他 Win10 电脑优先使用的稳定文件夹版。
- `packaging/`：文件夹版启动脚本、诊断脚本、用户先读说明、Inno Setup 安装包脚本、安装包构建脚本和发布签名脚本。
- `runtime_hooks/`：PyInstaller 运行时钩子，目前用于设置 Qt 插件路径。
- `class_tagger_config.json`：本地配置。

## 维护约定

- 修改界面逻辑时优先保持现有 PyQt 代码风格。
- 学生数据使用 `Student` 数据类，宿舍数据使用 `DormRoom` 数据类。
- 宿舍名单页面由 `DormRosterPage` 负责。
- 照片处理页面由 `PhotoProcessPage` 负责，用于单张照片本地检测人物/主体、抠图换蓝底、按宿舍门牌贴头像比例裁剪或留白，并可绑定到学生照片。
- 宿舍允许没有床位；已有床位中的空床位用 `None` 表示。
- 学生姓名、籍贯、班级变化应通过 `MainWindow.update_student_field()` 更新，以便刷新相关页面和自动保存。
- 学生照片变化应通过 `MainWindow.set_student_photo()` 更新，以便同步刷新数据导入、宿舍名字贴和宿舍名单页面。
- 宿舍门牌贴头像比例使用 `DORM_TAG_PHOTO_WIDTH_PX` 与 `DORM_TAG_PHOTO_HEIGHT_PX` 作为共享标准；照片处理页和 PDF 绘制应保持一致。
- 照片换底使用本地 `rembg` 人像分割能力，底色固定为蓝色 `#00acfd`，缺少依赖时页面应提示安装而不是影响软件启动。
- `rembg` 默认权重文件为用户目录 `.u2net/u2net.onnx`；用户首次点击“设置蓝底”且本机没有有效权重时，应先询问“此功能需要下载模型文件，是否下载？”，确认后显示带进度的下载弹窗，并提供“后台下载”和“取消下载”。
- 模型下载请求头必须只使用 ASCII 字符；不要把中文 `APP_NAME` 放进 `User-Agent`，否则 `urllib` 会因 latin-1 编码失败而下载失败。
- 模型下载默认使用 Gitee 仓库 `qianmugg/qxbanxiaozhu-models` 的 `u2net-v1` Release 分卷附件，按 `u2net.onnx.part1` 到 `part4` 顺序下载并合并；也可通过环境变量 `QXBAN_REMBG_MODEL_URLS` 用分号分隔传入自定义单文件模型地址。无论来源如何，下载完成后必须校验 MD5。
- 轻量安装包不要内置 `u2net.onnx`；目标电脑首次使用照片换底时，由 `ModelDownloadDialog` 下载到用户目录 `.u2net/u2net.onnx`。
- 使用 `packaging/Build-Installer.ps1` 构建安装包；该脚本先生成 PyInstaller 文件夹版，再调用 Inno Setup 6，输出 `dist/installer/QXBanXiaoZhu-Setup.exe`。
- 构建安装包时只从干净的 `dist/QXBanXiaoZhu-Win10/` 输出目录取文件，不要直接打包项目根目录；不得包含 `processed_photos/`、`logs/`、`class_tagger_config.json`、`更新后的学生信息表.xlsx`、`更新后的学生名单.xlsx`、`u2net.onnx`、用户照片目录或历史发布包。
- stock `rembg.bg` 在模块顶层会导入 `cv2`、`pymatting`、`scipy` 和 `numba`，不要直接排除这些核心依赖；当前可排除的是未使用的 scipy 子包、`skimage`、Qt 翻译目录和 OpenCV 视频 DLL，并且每次优化后都要验证照片换底功能。
- 安装包默认仅当前用户安装到 `%LOCALAPPDATA%\Programs\QXBanXiaoZhu`；卸载只删除程序目录，保留最终用户 `%APPDATA%\QX班小助` 下的个人数据。
- 给其他电脑分发时优先使用 `QXBanXiaoZhu-Win10.spec` 生成文件夹版；不要只发送单个 `QXBanXiaoZhu.exe`，必须连同 `_internal` 一起分发。
- 文件夹版优先让用户运行 `Start-QXBanXiaoZhu.bat`；打不开时运行 `Run-Diagnostics.bat` 并收集 `startup-diagnostic.log`。
- 如果有正式代码签名证书，应在 PyInstaller 构建完成并复制辅助文件后、压缩 zip 前运行 `packaging/Sign-Release.ps1`，只签名 `QXBanXiaoZhu.exe` 和 `QXBanXiaoZhu-Debug.exe`。
- 代码签名证书和密码不要保存到项目仓库；通过脚本参数传入，签名后用 `signtool verify /pa /v` 验证。

## 最近学到的需求

- 添加宿舍时默认自动放 1 个空床位，但宿舍后续允许删到 0 个床位。
- 宿舍名单页面中的学生姓名需要允许修改。
- 宿舍名单页面修改学生姓名或籍贯后，需要同步刷新“数据导入”页面，并自动写入 `更新后的学生名单.xlsx`。
- 宿舍名单左侧宿舍区域不应在宽屏下过度拉宽，应根据窗口大小限制宽度。
- 宿舍卡片高度应由床位数量决定，一个床位的宿舍不应显示成过高的大框。
- 单文件 exe 在其他电脑上更容易受安全软件、临时解压和 Qt 插件路径影响，Win10 稳定包改用文件夹版、ASCII 程序文件名、禁用 UPX、附带诊断入口。
- 代码签名流程已补齐：`packaging/Sign-Release.ps1` 会寻找 Windows SDK 的 `signtool.exe`，使用 SHA256 和 DigiCert 时间戳服务器签名两个发布 exe；没有证书时先保留流程，等正式 `.pfx/.p12` 证书到位后再签名。
- 照片处理新增独立页面：用户选择任意规格照片后，本地流程为“检测人物/主体区域 → 抠图或分割背景 → 设置蓝底 → 按固定比例居中裁剪 → 输出固定尺寸照片”；裁剪时允许拖动调整位置，不再提供完整留白模式。
- 处理后的照片可另存为 PNG/JPG；绑定学生时应先弹出学生名单让用户确认，再自动保存到应用数据目录并直接调用 `set_student_photo()`，不要让用户先走“另存为”弹窗。
- 顶部导航当前选项卡使用浅灰色高亮；“导入学生名单”主按钮避免使用过深底色，优先使用柔和浅色强调。
- 班级座位表页面应使用横向 A4 纸张作为画布预览背景，并让导出 PDF 使用同一横向 A4 比例，便于用户预览最终显示效果。
- 班级座位表需要支持“重置座位表”“上一步”“下一步”；启动软件时应优先读取上一次保存的座位表，没有可用记录时首次进入显示默认座位表。
- 添加座位时不要自动把整张班级座位表视图移动到新座位位置，应保持当前整体预览稳定。
- “重置座位表”应根据“数据导入”页当前导入的学生名单重新生成默认座位表，并按学生人数自动补足行列；不要读取上次手动调整后的座位。
- 班级座位表支持小步长左移、右移，移动的是座位表内容在横向 A4 纸上的位置，导出 PDF 应与预览纸面比例和位置一致。
- 班级座位表四向移动（上移、下移、左移、右移）只能移动座位表内容，不能改变横向 A4 预览纸或画布大小；四个移动按钮应放在同一组。
- 宿舍名单页需要有“最近宿舍表”；导出或读取宿舍表后加入最近列表，读取时根据当前导入学生名单按姓名/籍贯匹配并恢复之前的宿舍安排。

## 本地拉取与 Web 化迁移记录

- 2026-06-22 已在本机通过 GitHub CLI 登录 `Monster-qianmu`，并将私有仓库克隆到本地工作区。
- 本地工作区路径属于开发者环境，不作为公开部署约定；命令均应在仓库根目录执行。
- 由于当前项目核心能力集中在 Python 生态（`openpyxl`、`Pillow`、`rembg`、`onnxruntime`、Qt PDF 绘制），在线 Web 化优先考虑保留 Python 作为后端核心语言。
- 推荐迁移基线：后端使用 Python + FastAPI，前端使用 TypeScript + React；座位表、宿舍贴纸等交互画布可使用 Canvas/SVG/Konva/Fabric.js 实现。
- 迁移前应先拆分 `main.py`：把学生数据、Excel 读写、照片处理、宿舍/座位布局、PDF 导出等逻辑抽成可测试的纯业务模块，再让 PyQt UI 和 Web API 共用同一套核心逻辑。
- 线上版首选部署到斐讯 N1：前端用 React/Vite 构建静态文件并由 Nginx 或 Caddy 服务，后端用 FastAPI ARM64 镜像运行，数据目录挂载到 N1 磁盘。
- 第一版线上数据层使用 SQLite + 本地文件目录，不要一开始引入 PostgreSQL；本地文件目录用于保存数据库、上传照片、处理后照片和导出文件。
- Docker 部署建议拆成 `frontend`、`backend`、`data` 三层：`frontend` 只服务静态资源，`backend` 负责 API 与业务逻辑，`data` 通过 volume 持久化。
- N1 资源有限，`rembg` + `onnxruntime` 抠图换蓝底属于重功能；第一版线上版优先保留 Excel、座位表、宿舍贴、宿舍名单和 PDF 导出。照片蓝底处理应作为可选功能，或放入异步任务并限制并发为 1。
- Web 化迁移计划记录在 `docs/online-migration-plan.md`，后续拆分核心模块和新增 FastAPI/React 工程时应同步更新。

## 线上版实现记录

- 2026-06-22 已新增 `qx_core/` 共享业务包，用于承载 Web 后端和桌面版可共用的纯 Python 能力：学生/宿舍模型、Excel 读写、照片匹配、座位表状态、宿舍贴排版和 ReportLab PDF 导出。
- `main.py` 已开始复用 `qx_core` 中的 `Student`、`DormRoom`、学生 Excel、宿舍 Excel 和照片匹配函数；桌面版 PyQt UI、Qt 画布、Qt PDF 导出和本地照片蓝底处理仍保留。
- 新增 `backend/` FastAPI 服务，API 使用 `/api/v1` 前缀；SQLite 通过 SQLModel 管理，结构化数据保存在 `qxban.db`，上传、照片和导出文件保存在 `QXBAN_DATA_DIR` 下的 `uploads/`、`photos/`、`exports/`。
- 新增 `frontend/` TypeScript + React + Vite 工作台，使用 `@tanstack/react-query` 访问 API，使用 `react-konva` 绘制座位表，使用 `lucide-react` 图标。
- 新增 Docker 部署：`backend/Dockerfile`、`frontend/Dockerfile`、`frontend/nginx.conf`、`docker-compose.yml`。N1 默认挂载 `/data/qxbanxiaozhu:/app/data`，前端通过 Nginx 服务并反代 `/api/` 到后端。
- 本地后端开发推荐命令：`QXBAN_DATA_DIR="$PWD/backend/.data" QXBAN_DB_PATH="$PWD/backend/.data/qxban.db" .venv/bin/uvicorn backend.app.main:app --reload`。
- 本地前端开发推荐命令：进入 `frontend/` 后运行 `npm install` 和 `npm run dev`。
- 测试方式：`.venv/bin/pytest -q` 覆盖核心与 API；`cd frontend && npm run build && npm audit` 覆盖前端构建和依赖审计。
- 线上版第一版仍按单用户局域网使用设计，未加入账号登录；如要公网开放，必须先补认证、权限控制、HTTPS 和上传大小/频率限制。
- N1 基础镜像不安装 `rembg`、`onnxruntime`，蓝底抠图在 Web 版默认关闭；后续如启用应拆成 extra 或独立 worker，并保持 `QXBAN_PHOTO_TASK_CONCURRENCY=1`。
- N1 部署使用 Docker Compose；设备地址、SSH 配置、远端目录和端口映射均由部署者在本地环境配置，不写入公开仓库。
- N1 数据目录为 `/data/qxbanxiaozhu`，当前实际位于 overlay 根文件系统上，不是独立大容量磁盘；部署后根分区约 1.9G，总占用约 650M，剩余约 1.2G。后续上传大量照片或导出 PDF 前，应优先确认是否有外接磁盘可挂载到 `/data/qxbanxiaozhu`。

## 本地 Mac mini 部署记录

- 2026-06-22 已在本机完成 Web 迁移版开发模式部署。
- 本地部署采用开发模式，不使用 `docker-compose.yml` 的 `/data/qxbanxiaozhu:/app/data` 系统级挂载；后端数据目录固定为项目内 `backend/.data`，数据库为 `backend/.data/qxban.db`。
- 后端启动命令：`QXBAN_DATA_DIR="$PWD/backend/.data" QXBAN_DB_PATH="$PWD/backend/.data/qxban.db" .venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload`。
- 前端启动命令：进入 `frontend/` 后运行 `npm run dev -- --host 0.0.0.0`；Vite 会把 `/api` 代理到 `http://127.0.0.1:8000`。
- 本机开发入口为 `http://localhost:5173/`；局域网访问地址应按当前主机网络配置确定。
- 当前后端健康检查：`http://127.0.0.1:8000/api/v1/health`；也可通过前端代理访问 `http://localhost:5173/api/v1/health`。
- 这次本地验证结果：`.venv/bin/pytest -q` 通过 5 个测试；`cd frontend && npm run build` 通过；`curl` 验证前端首页返回 200，前端代理的 `/api/v1/health` 返回 `ok: true`。
- 当前环境版本：Python 3.14.5、Node.js v26.0.0、npm 11.12.1。测试中存在 `datetime.utcnow()` 和 Starlette TestClient 的弃用警告，暂未影响运行。

## 数据导入页手动维护记录

- 2026-06-22 Web 版“数据导入”页面已支持手动新增学生：前端调用 `POST /api/v1/projects/{project_id}/students`，后端使用当前项目最大 `student_index + 1` 生成序号，姓名为空时返回 400。
- 手动新增学生后会刷新 `students`、`seats`、`dorms` 查询，并在后端重建当前项目座位表，避免“宿舍名单”“宿舍贴”“照片管理”等页面拿到旧学生列表。
- “数据导入”页面已有删除学生按钮，本次补充删除成功状态提示、删除期间按钮禁用，以及删除后刷新宿舍查询；后端删除学生时会重排序号、清空宿舍床位中指向该学生的引用，并重建座位表。
- 新增学生表单使用受控输入，React 事件处理里必须先读取 `event.currentTarget.value` 到局部变量，再进入 `setState` 回调；不要在状态更新函数里直接读取 `event.currentTarget`，否则浏览器运行时可能因 `currentTarget` 变为 `null` 崩溃。
- 为方便浏览器回归验证，新增表单和学生行使用 `data-testid`：`new-student-name`、`new-student-hometown`、`new-student-class`、`new-student-submit`、`student-row-{id}`、`delete-student-{id}`。
- 本次验证：`.venv/bin/pytest -q` 通过 5 个测试，`cd frontend && npm run build` 通过；在内置浏览器 `http://localhost:5173/` 实测新增临时学生后表格出现该学生，点击删除后状态栏显示已删除且表格移除。
- 2026-06-22 “数据导入”页新增逐学生照片上传入口：照片列显示绑定状态和上传按钮，前端复用 `photos/upload` + `students/{id}/photo` 接口，上传成功后刷新当前班级 `students` 查询。
- 2026-06-22 数据导入页班级上下文以顶部选中的班级为准：新增学生的班级输入框默认当前班级且只读，学生表班级列也只读显示当前班级；后端 Excel 导入、手动新增和 class_name patch 都以 `ProjectRecord.name` 写入，避免同一班级项目里混入其它班名。

## Web 版班级选择记录

- 2026-06-22 Web 版已将后端 `ProjectRecord` 显式作为“班级”使用：进入系统后顶部提供班级下拉框和新建班级输入框，所有页面通过当前选中的 `project.id` 读取数据。
- 前端当前班级状态由 `selectedProjectId` 维护，不再固定使用 `projects[0]`；学生名单、座位表、宿舍名单、宿舍贴和照片绑定页面都接收当前 `project.id` 作为 `projectId`。
- 新建班级成功后必须先用 `queryClient.setQueryData(["projects"], ...)` 把新班级写入 React Query 缓存，再设置 `selectedProjectId`；否则旧项目列表 effect 会因为“列表里暂时没有新 ID”把当前班级切回旧班级。
- 选择班级和新建班级控件使用 `data-testid`：`class-select`、`new-class-name`、`create-class`，方便浏览器回归验证。
- 切换班级时，学生手动新增表单和照片绑定页面的学生选择/照片文件会清空，避免把上一个班级的未提交状态带到新班级。
- 后端测试已覆盖两个班级的学生列表和座位表互不串班；浏览器实测两个临时班级各新增一个学生后，切换班级时“数据导入”“宿舍贴”“照片管理”“宿舍名单”中的学生名单均按当前班级隔离。

## 宿舍名单人员选择记录

- 2026-06-22 Web 版宿舍名单中，学生一旦被安排到任意宿舍床位，在其它床位的人员下拉中必须显示为灰色禁用状态，并追加“（已安排）”标注；当前床位已经选中的学生仍保持可显示、可保留。
- 前端实现使用 `frontend/src/dorms.ts` 中的纯函数：`assignedStudentIdsForRooms()` 收集已安排学生 ID，`isStudentAssignedElsewhere()` 判断某学生是否应在当前床位禁用，`dormStudentOptionLabel()` 负责追加标注。
- 宿舍床位下拉使用 `data-testid="dorm-bed-select-{roomIndex}-{bedIndex}"`，便于后续浏览器或组件测试定位。
- 已安排学生 option 同时设置 `disabled` 和 `assigned-student-option` 类名；原生下拉会禁用不可选，CSS 中也对 disabled option 设置灰色背景和文字。
- 本次验证：`cd frontend && npm run test` 覆盖“其它床位禁用”和“当前床位本人不禁用”；`cd frontend && npm run build`、`.venv/bin/pytest -q` 均通过。内置浏览器当前存在 `codex-browser-sidebar-comments-root` 覆盖层拦截点击，无法完成宿舍页点击流验证。

## 班级座位表新版记录

- 2026-06-22 Web 版座位表使用固定横向 A4 逻辑纸面坐标：前后端统一为 `1120 x 792`，前端只按比例缩放显示，保存和 PDF 导出都使用同一套真实纸面坐标。
- 新生成布局版本为 `version=3`；旧布局会优先按已保存内容恢复，用户点击“重置座位表”后才会按新版规则根据当前学生名单重新生成。
- 座位基础矩形尺寸为 `88 x 50`，讲台基础高度为 `60`；默认 5 行 x 5 列，超过 25 人时自动补足行数，最多 12 行 x 12 列。
- 学生填充顺序为靠近讲台的第 1 排从左到右，然后向后排填充；由于画面从上到下显示后排到前排，默认生成时学生名单会写入视觉最底部一排。
- `qx_core/seats.py` 的 `paper_rect()` 现在固定返回横向 A4 逻辑纸面，不再根据内容动态扩张；`export_seat_pdf()` 通过该固定纸面映射到 ReportLab 横向 A4。
- 前端座位表交互规则集中在 `frontend/src/seats.ts`：行列裁剪、默认位置、近网格吸附、单座位边界、整表四向移动边界、新增座位位置都在这里维护。
- 2026-06-22 新增 `scale_percent` 字段，语义是“座位网格宽度占横向 A4 有效纸宽的百分比”。旧 `version=2` 布局读取时会自动按当前坐标反算默认百分比，保存后升级为 `version=3`。
- 座位表百分比只改变座位表内容尺寸，不改变 A4 纸面 `1120 x 792`；前端预览、拖拽吸附、边界限制、整表移动和后端 PDF 导出都必须使用同一个百分比计算。
- 2026-06-22 修复旧座位布局兼容问题：数据库中曾保存过旧 `84 x 48` 网格坐标，读取后会导致新版 `88 x 50` 讲台框架与座位格错位；现在前后端读取规则旧网格时会按当前 `scale_percent` 校准到新版格宽格高，非规则手动拖拽布局不会被强制重排。
- 2026-06-22 座位拖拽吸附从只吸附当前行列内格线，改为吸附到按当前网格节奏延伸的格线，并把已有座位的 x/y 坐标作为候选吸附线；基础吸附距离为 `18` 纸面单位，并随座位尺寸轻微增大。
- 座位表保存成功后，前端必须用后端返回布局同步 `React Query` 的 `["seats", projectId]` 缓存，并提示“座位表已保存到数据库”，避免切换页面或班级后先显示旧缓存。
- 2026-06-22 新生成/重置座位表默认 `scale_percent=60`，座位网格在横向 A4 纸面中居中，`row_label_position` 默认为 `none`；已有保存布局仍优先从数据库恢复，不强制改成新默认值。
- 2026-06-22 座位表用户改动后会触发 4 秒防抖自动保存；提示文案为“座位表发生改动，【x】秒后将自动保存。”，倒计时期间继续编辑会重新计时，手动保存或切换/重置会清理待保存计时器。
- 前端座位页支持标题编辑、行列 1 到 12 调整、排标注位置、选中座位、编辑姓名、删除座位、添加“新座位”、拖拽吸附、四向移动、上一步/下一步；撤销/重做各保留最近 3 步。
- 座位拖拽只能留在 A4 有效区域内，且不能覆盖讲台；整表四向移动只改变 `left/top` 与各座位 `x/y`，不改变纸张尺寸。
- 本次验证：`cd frontend && npm run test` 覆盖座位填充顺序、吸附、行列范围和百分比缩放；`cd frontend && npm run build` 通过；`.venv/bin/pytest -q` 覆盖默认 5x5、固定纸面、`scale_percent` 保存字段和 PDF smoke。
- 2026-06-22 根据用户反馈“座位表整体太小”，在不改变 A4 纸面 `1120 x 792` 的前提下，将座位卡片从 `84 x 48` 调整为 `88 x 50`，并将顶部预留 `SEAT_TITLE_OFFSET` 从 `92` 调整为 `76`，让 12 行仍可放入纸面有效区域。

## 2026-07-09 在线版继续改写记录

- 用户反馈“很多功能没有实现，效果也差很多”，后续在线版改写应优先补齐桌面版核心流程，而不是只搭 API 和基础表单。
- Web 版座位表页面已重排为更完整的编辑器：顶部状态栏、左侧检查器、右侧横向 A4 纸面预览；保留标题、行列、纸宽百分比、排标注、选中座位、添加/删除、整表四向移动、撤销/重做、自动保存和 PDF 导出。
- 座位表前端预览新增打印安全边距、浅色网格线、纸张阴影、选中座位高亮，视觉上更接近“所见即所得的横向 A4 打印预览”。
- Web 版新增学生信息样表下载接口 `GET /api/v1/templates/student-info/download`，前端“数据导入”页增加样表下载按钮，补齐桌面版“样表下载”流程。
- Web 版“宿舍贴”页面新增在线预览：支持门牌贴/床柜贴样式切换、选中学生数量统计、点击预览卡片取消选择，并保留两种 PDF 导出。
- Web 版“照片管理”页面新增待绑定照片预览、选中学生提示、学生照片状态网格；点击学生卡可快速选择绑定目标。
- 本次验证：`.venv/bin/pytest -q` 通过 6 个后端测试，`cd frontend && npm run test` 通过 2 个测试文件 9 个测试，`cd frontend && npm run build` 通过；Vite 仍提示单 chunk 超过 500 kB，可后续用动态导入拆分。
- Web 版“宿舍名单”页面新增宿舍/床位/已安排统计、未安排学生池、点击未安排学生快速分配到下一个空床位、未保存状态、导出标题输入和更清晰的保存/导出操作区。
- Web 版“数据导入”页面新增班级资料总览和 4 步流程条：下载样表、导入名单、绑定照片、导出更新表；保留原表格编辑和逐学生照片上传。
- 本次追加验证：`.venv/bin/pytest -q`、`cd frontend && npm run test`、`cd frontend && npm run build` 均通过。
- Web 版“照片管理”页面新增批量照片导入：前端允许一次选择多张图片，后端 `POST /api/v1/projects/{project_id}/photos/import` 复用 `qx_core.photos.normalize_name()` 按文件名匹配学生姓名，返回精确匹配、模糊匹配、未匹配、多重匹配、重复和拒绝等结果；成功匹配的照片统一复制到受管照片目录并写回学生 `photo_match_status`。
- 批量照片导入测试覆盖 `张三.jpg` 精确匹配、`李四生活照.jpeg` 模糊匹配和陌生照片未匹配；本次验证：`.venv/bin/pytest -q` 通过 6 个后端测试，`cd frontend && npm run test` 通过 2 个测试文件 9 个测试，`cd frontend && npm run build` 通过，Vite 仍仅提示单 chunk 超过 500 kB。
- Web 版“宿舍名单”页面新增最近宿舍表：后端把导入的宿舍 Excel 记录为 `dorm_excel`，把导出的宿舍安排表记录为 `dorm_roster`，通过 `GET /api/v1/projects/{project_id}/dorms/recent` 返回当前班级最近 6 个仍存在的宿舍表；点击最近记录时调用 `POST /api/v1/projects/{project_id}/dorms/recent/{file_id}/restore`，按当前学生名单重新用姓名/籍贯匹配并恢复床位安排。
- 最近宿舍表在前端显示于宿舍名单左侧操作区，导入或导出后刷新最近列表，恢复后同步 `["dorms", projectId]` 缓存并清除未保存状态；本次验证：`.venv/bin/pytest -q`、`cd frontend && npm run test`、`cd frontend && npm run build` 均通过，Vite 仍仅提示单 chunk 超过 500 kB。
- Web 版“宿舍贴”页面的预览卡已从只读按钮改为可编辑贴纸卡：右上角勾选按钮用于取消选择，照片区域可直接上传替换学生照片，姓名和籍贯输入框失焦后调用学生 patch 接口并同步刷新学生列表和座位表缓存。
- Web 版班级名仍以 `ProjectRecord.name` 为准；本次新增 `PATCH /api/v1/projects/{project_id}`，贴纸卡里编辑“班级”时实际会重命名当前班级项目，并同步更新本班所有学生 `class_name`，不要把同一项目内学生改成不同班级名。
- 本次验证补充项目改名后学生 `class_name` 同步更新的后端测试；`.venv/bin/pytest -q`、`cd frontend && npm run test`、`cd frontend && npm run build` 均通过，Vite 仍仅提示单 chunk 超过 500 kB。
- Web 版“宿舍名单”页面新增拖拽安排：未安排学生卡片可拖到任意床位，已有床位可拖到同宿舍其它床位调整顺序，也可拖到其它宿舍床位交换；原有点击未安排学生自动分配、床位下拉选择、添加/删除床位继续保留，便于移动端或不方便拖拽时使用。
- 宿舍拖拽规则集中在 `frontend/src/dorms.ts` 的纯函数中：`assignStudentToBed()` 会避免同一学生重复安排，`moveBedStudent()` 处理跨床位交换，`reorderBedWithinRoom()` 处理同宿舍床位顺序调整；本次新增 Vitest 覆盖这三类行为。
- 本次验证：`.venv/bin/pytest -q` 通过 6 个后端测试，`cd frontend && npm run test` 通过 2 个测试文件 12 个测试，`cd frontend && npm run build` 通过，Vite 仍仅提示单 chunk 超过 500 kB。
- Web 版“照片管理”页面新增轻量照片处理：单张照片选择后显示固定 `160 x 210` 宿舍贴头像比例裁剪框，支持缩放、左右偏移、上下偏移和重置；点击“裁剪后绑定”时在浏览器端用 Canvas 生成 PNG，再复用现有上传和绑定接口保存为学生照片。
- 当前 Web 版照片处理仍不启用 `rembg` 蓝底抠图，裁剪画布的背景色沿用 `#00acfd`；这一路径适合 N1 低资源环境，后续若恢复蓝底抠图应继续作为可选后台任务或独立 worker。
- 照片裁剪规则集中在 `frontend/src/photos.ts`，`photoCropSourceRect()` 使用 cover 逻辑计算源图裁剪区域并限制缩放/偏移不越界；本次新增 Vitest 覆盖宽图、竖图、缩放偏移和参数裁剪。
- 本次验证：`.venv/bin/pytest -q` 通过 6 个后端测试，`cd frontend && npm run test` 通过 3 个测试文件 16 个测试，`cd frontend && npm run build` 通过，Vite 仍仅提示单 chunk 超过 500 kB。
- Web 版新增项目级最近活动记录：后端新增 `ActivityRecord` SQLite 表和 `GET /api/v1/projects/{project_id}/activities`，关键操作会写入中文活动消息，包括创建/改名班级、导入/导出学生、增删改学生、照片绑定/批量导入、座位表保存/重置/导出、宿舍读取/保存/导出/恢复、宿舍贴导出。
- 前端 App 顶部新增“最近活动”轻量面板，按当前班级读取最近活动，操作成功后通过统一 `reportStatus()` 刷新活动流，同时保留原来的短状态提示；活动流用于用户确认和近期排查，不是完整安全审计系统。
- 本次验证补充后端活动接口测试，断言创建班级、导入学生名单、导出座位表和班级改名会出现在活动记录中；`.venv/bin/pytest -q`、`cd frontend && npm run test`、`cd frontend && npm run build` 均通过，Vite 仍仅提示单 chunk 超过 500 kB。
- 2026-07-10 使用本地真实样本测试照片流程；样本共 22 张，命名主要为 `序号_姓名.jpg/png`，其中 `06_.jpg` 缺少姓名。改进后清理序号和噪声后等于学生姓名的文件标为 `strict`，批量上传结果为 21 张精确匹配、1 张“文件名缺少学生姓名”未匹配。
- `qx_core.photos.find_photo_for_name()` 和后端批量导入匹配规则保持一致：先按完整文件名精确匹配，再按归一化文件名等于归一化学生名判定 `strict`，最后才用包含关系判定 `fuzzy`；空归一化文件名返回更明确的未匹配原因。
- Web 版“照片管理”批量导入区新增“选择照片文件夹”入口，使用浏览器目录选择能力一次导入整批照片；仍保留“选择多张照片”入口。相关测试已覆盖 `01_张三.jpg` 精确匹配、`李四生活照.jpeg` 模糊匹配、陌生照片未匹配和 `06_.jpg` 缺姓名提示。
- 本次验证：真实样本脚本上传通过；`.venv/bin/pytest -q` 通过 6 个后端测试，`cd frontend && npm run test` 通过 3 个测试文件 16 个测试，`cd frontend && npm run build` 通过，Vite 仍仅提示单 chunk 超过 500 kB。
- Web 版“照片管理”批量导入结果现在会为所有成功保存的图片返回 `file_id` 和 `download_url`；即使是 `06_.jpg` 这类未匹配照片，也能在结果列表中直接绑定到当前选中的学生，不需要用户重新选择文件。
- 前端批量导入结果行只对“已有上传文件但尚未绑定学生”的条目显示“绑定选中”按钮；绑定成功后该行状态改为 `manual`，并刷新学生照片列表。
- 本次补充验证：真实样本目录上传结果仍为 21 张 `strict`、1 张 `unmatched`，且 `06_.jpg` 返回了可用于手动绑定的 `file_id` 和 `/api/v1/files/{id}/download` 地址。
- Web 版“照片管理”批量导入结果新增固定比例缩略图预览，使用 `download_url` 直接展示已上传图片；缩略图可点开原图，未自动绑定的条目会高亮提示需要处理。真实样本中 `06_.jpg` 这类缺姓名文件必须能通过缩略图辅助人工判断，再配合“绑定选中”完成修正。
- 后端测试已覆盖未匹配照片的 `download_url` 可直接下载到原上传内容，避免前端缩略图拿到失效地址。
- Web 版“照片管理”批量导入结果新增筛选：`需处理`、`已绑定`、`全部`。导入完成后如果存在 `file_id` 有值但 `student_id` 为空的照片，会默认切到 `需处理`，让真实样本里 `06_.jpg` 这类问题项直接浮出来。
- 批量照片结果筛选规则集中在 `frontend/src/photos.ts`：有 `student_id` 算已绑定；有 `file_id` 但没有 `student_id` 算需处理；拒绝项没有上传文件，不进入需处理。相关 Vitest 已覆盖计数和筛选。
- 真实样本的照片序号存在缺口：缺 `02`、`04`、`18`，且 `06_.jpg` 缺姓名。因此照片管理不能只从“导入了哪些照片”判断完成，还必须从学生维度检查“还有哪些学生缺照片”。
- Web 版“照片管理”学生照片网格新增 `缺照片`、`已绑定`、`全部` 筛选；批量导入完成后默认切到 `缺照片`，便于老师把未匹配照片和缺照片学生配对处理。右侧状态指标改为已绑定、缺照片、总人数。
- 学生照片覆盖率规则集中在 `frontend/src/photos.ts`：有 `photo_url` 算已绑定，没有 `photo_url` 算缺照片。相关 Vitest 已覆盖计数和筛选。
- Web 版绑定到学生的受管照片现在统一规格化为 `160 x 210` PNG，背景色沿用宿舍贴蓝底 `#00acfd`；批量自动匹配和手动绑定都会走同一条 `qx_core.photos.copy_managed_photo()` 处理链路。
- 原始上传文件仍保留在 `photo_upload` 记录中，用于批量导入结果缩略图、打开原图和未匹配照片人工判断；学生 `photo_url` 指向的是规格化后的 `student_photo` 文件。后端记录这类文件时应使用 `image/png` content type。
- 本次真实样本验证：上传后仍为 21 张 `strict`、1 张 `unmatched`；下载首个已绑定学生照片得到 `image/png`，尺寸为 `160 x 210`，缺照片学生数为 0。
- Web 版批量照片导入新增文件名前缀序号检查：`qx_core.photos.photo_sequence_summary()` 会从文件名开头提取数字序号，返回已有序号和最小到最大之间的缺口。后端 `PhotoImportOut` 返回 `sequence_numbers` 和 `missing_sequence_numbers`，前端在最近批量导入卡片中提示“文件序号缺口”。
- 真实样本序号检查结果为已有 `[1,3,5,6,7,...,25]`，缺口 `[2,4,18]`；这个提示用于辅助老师发现未拍、漏传或文件命名跳号的照片，不参与学生姓名匹配本身。
- Web 版批量照片导入对未匹配照片新增“按序号建议学生”：如果照片文件名前缀序号等于学生名单 `student_index`，且该学生本批没有被其它照片使用、姓名也没有出现在本批其它文件名中，则在结果项返回 `suggested_student_id/name/index`，前端显示“建议：xx号 姓名”并提供“绑定建议”按钮。
- 序号建议只作为人工确认辅助，不参与自动匹配；真实样本用照片文件名临时推导学生名单时，`06_.jpg` 不会误建议到后续已有姓名照片的学生。若使用完整 25 人名单，`06_.jpg` 会建议第 6 号学生。
- Web 版“照片管理”学生照片网格和左侧选中学生卡都要显式显示学生序号；右侧头像左上角使用两位数序号角标，左侧选中卡显示“xx号 · 姓名”，便于和批量导入结果里的“建议：xx号 姓名”互相核对。
- Web 版批量照片导入会自动生成“照片导入核对清单” Excel，后端响应返回 `report_file_id/report_filename/report_download_url`，前端在“最近批量导入”卡片提供“下载清单”按钮。清单包含匹配/未匹配汇总、已有序号、缺失序号，以及每张照片的状态、说明、匹配学生、建议学生、上传文件 ID 和下载地址。
- 真实样本报告验证：下载 `照片导入核对清单-*.xlsx` 后，汇总缺失序号为 `02、04、18`，明细第一行记录 `01_危志康.png` 为“精确”匹配。
- Web 版“照片管理”新增已绑定照片 ZIP 导出：后端 `POST /api/v1/projects/{project_id}/photos/export-zip` 会把当前班级所有存在 `photo_path` 的受管照片按 `两位序号_姓名.png` 打包，前端“处理状态”区域提供“下载照片包”按钮；没有已绑定照片时返回 400。
- 真实样本照片包验证：导入后导出 ZIP，包含 21 张已绑定规格化 PNG，首个文件为 `01_危志康.png`，图片尺寸 `160 x 210`。
- “照片导入核对清单”Excel 现在包含 3 个工作表：`照片导入核对`、`学生照片覆盖`、`缺照片学生`。后两个表基于导入完成后的学生 `photo_path` 状态生成，便于老师从学生维度确认照片是否齐全。
- 真实样本覆盖表验证：导入后，`学生照片覆盖` 表有 21 名学生且全部为“已绑定”，`缺照片学生` 表无学生记录。
- Web 版“照片管理”新增当前照片状态清单导出：后端 `POST /api/v1/projects/{project_id}/photos/status-report` 会基于数据库当前学生 `photo_path` 生成 `照片状态清单-*.xlsx`，前端“处理状态”区域提供“下载状态清单”按钮。该清单用于人工修正后的最终核对，不依赖最近一次批量导入结果。
- 当前照片状态清单第一张表为 `照片状态清单`，包含总人数、已绑定照片、缺照片汇总，以及按学生序号排列的照片状态和中文匹配方式；第二张表为 `缺照片学生`。后端测试覆盖手动绑定后的 `手动/模糊` 匹配方式导出。
- 本次真实样本验证：使用临时数据目录导入 22 个照片文件生成 21 名学生，批量导入结果为 21 张匹配、1 张缺姓名未匹配，状态清单汇总为总人数 21、已绑定 21、缺照片 0。
- Web 版批量照片导入的文件序号缺口现在会返回 `sequence_gap_students`，把缺失序号映射到当前学生名单里的学生，并带上该学生当前是否已有照片；前端“文件序号缺口”提示会显示如 `02号 姓名（缺照片）` 或 `02号 姓名（已绑定）`，避免老师只看到数字还要回名单里查。
- “照片导入核对清单”Excel 新增 `文件序号缺口` 工作表，列出缺失序号、名单学生、学生 ID、籍贯、班级、照片状态和匹配方式。该表和 `缺照片学生` 表语义不同：前者检查照片文件命名序号是否连续，后者检查学生维度是否最终有照片。
- 本次完整真实样本验证：构造 1 到 25 号完整名单后导入照片，22 个文件中 21 张自动匹配、`06_.jpg` 未匹配但建议 06 号，`sequence_gap_students` 返回 02、04、18 三名缺照片学生。
- Web 版“文件序号缺口”中的对应学生现在渲染为可点击按钮；点击后会选中该学生，并按其当前照片状态自动切换学生照片网格到 `缺照片` 或 `已绑定` 筛选，方便老师从缺口提示直接定位到学生卡。
- 如果用户通过单张裁剪绑定或批量导入结果手动绑定了某个缺口学生，前端会同步把该缺口按钮状态更新为“已绑定”，避免最近批量导入卡片继续显示旧状态。
- 本次真实样本回归：完整 25 人名单导入后，前端可渲染的缺口按钮标签为 `02号 02号同学（缺照片）`、`04号 04号同学（缺照片）`、`18号 18号同学（缺照片）`。
- Web 版“最近批量导入”新增“绑定全部建议”按钮：前端通过 `photoImportSuggestedBinds()` 收集所有已有 `file_id`、`suggested_student_id` 且尚未绑定的照片，按顺序调用现有单张绑定接口，避免老师逐条点击“绑定建议”。
- 批量建议绑定仍沿用后端 `students/{student_id}/photo` 处理链路，会把学生照片规格化为 `160 x 210` PNG 并将匹配方式写为 `manual`；绑定过程中会禁用单条“绑定建议/绑定选中”按钮，避免重复提交同一照片。
- 本次真实样本验证：完整 25 人名单导入后，`06_.jpg` 被收集为唯一建议绑定项，执行绑定后 06 号学生已有照片，最终缺照片序号只剩 02、04、18。
- 受管学生照片生成时必须先应用图片 EXIF 方向：`qx_core.photos.copy_managed_photo()` 使用 `ImageOps.exif_transpose()` 后再换蓝底、裁剪和输出 `160 x 210` PNG，避免手机照片只靠 EXIF 标记旋转时导出的头像方向错误。
- 新增核心测试用带 EXIF orientation=6 的 JPEG 验证规格化照片方向；真实样本当前 EXIF 方向多为空或 1，本次回归确认导入后仍为 21 张匹配、首张受管照片 `160 x 210` PNG、照片包 21 张。
- Web 版新增清除学生照片能力：后端 `DELETE /api/v1/projects/{project_id}/students/{student_id}/photo` 会清空学生当前 `photo_path`，把 `photo_match_status` 设为 `missing`，并保留历史上传/导入文件，方便从最近批量导入结果中重新绑定。
- 前端“学生照片检查”卡片在已绑定照片时显示“清除”按钮；卡片本身仍可点击选择学生，清除按钮会阻止事件冒泡，避免误切换。清除后会刷新学生列表，并同步更新文件序号缺口按钮的“缺照片/已绑定”状态。
- 本次真实样本验证：导入后清除 01 号危志康照片，状态清单变为已绑定 20、缺照片 1，`缺照片学生` 表列出危志康，照片包导出变为 20 张且不包含 `01_危志康.png`。
- 清除某个学生照片后，前端最近批量导入结果中绑定到该学生的照片会通过 `clearPhotoImportBindingForStudent()` 回到“需处理”队列：保留原始上传 `file_id` 和缩略图，但清空 `student_id/student_name`，状态显示为“未匹配”，说明为“已清除绑定，可重新处理”。
- 清除照片后前端会自动切换到批量结果 `需处理` 筛选和学生照片网格 `缺照片` 筛选，方便老师立即从原导入照片重新绑定或改绑其它学生。
- 清除后的导入结果应保留原绑定学生作为 `suggested_student_id/suggested_student_name`，这样该照片会重新出现“绑定建议”，也会被“绑定全部建议”收集；真实样本验证中清除 `01_危志康.png` 后，可直接用原导入文件重新按建议绑定回危志康。
- Web 版批量照片导入现在会读取每张成功上传图片的原始宽度、高度和格式，后端 `PhotoImportItemOut` 返回 `image_width/image_height/image_format`，前端导入结果行显示“原图：宽 x 高 · 格式”，方便老师发现异常尺寸或来源格式。
- “照片导入核对清单”主表新增 `图片尺寸` 和 `图片格式` 两列，位于建议学生之后、上传文件 ID 之前；真实样本验证中 `01_危志康.png` 记录为 `295 x 413 / PNG`，`06_.jpg` 记录为 `1024 x 1368 / JPEG`。
- “照片导入核对清单”新增 `图片规格汇总` 工作表，按“图片尺寸 + 图片格式”聚合数量并列出最多 3 个示例文件，便于老师快速发现少量异常规格。真实样本规格分布验证：`750 x 1000 / JPEG` 为 9 张，`295 x 413 / PNG` 为 6 张，`1024 x 1366 / JPEG` 为 2 张，`1024 x 1368 / JPEG` 为 1 张。
- Web 版“最近批量导入”卡片也会展示图片规格摘要，前端 `photoImageSpecSummary()` 按尺寸和格式聚合，并将只有 1 张的规格用较醒目的样式标出；页面最多显示前 6 个规格，完整分布仍以 Excel `图片规格汇总` 表为准。
- Web 版批量照片导入现在会在保存上传文件后用 Pillow 读取图片元信息；扩展名合法但内容无法读取的图片标记为 `rejected`，提示“图片文件无法读取，请检查图片是否损坏。”，仍返回 `file_id/download_url` 方便老师下载排查。
- 前端 `photoImportNeedsReview()` 会排除 `rejected` 项，即使损坏图片有上传文件 ID，也不进入“需处理”绑定队列；`photoImageSpecSummary()` 会把这类图片聚合为“无法读取 / 未知”，Excel `图片规格汇总` 也保留同样统计。
- 2026-07-10 收口验证：`.venv/bin/pytest -q` 通过 10 个后端测试，`cd frontend && npm run test -- --run` 通过 3 个测试文件 26 个前端测试，`cd frontend && npm run build` 通过；Vite 仍仅提示单 chunk 超过 500 kB。
- 本机开发服务验证：`http://127.0.0.1:5173/` 返回 200，`http://127.0.0.1:8000/api/v1/health` 返回 `ok: true`、`photo_background_enabled: false`，符合 N1 基础镜像默认不启用蓝底抠图的设定。
- 真实样本回归：22 张照片导入完整 25 人名单后，21 张 `strict` 自动匹配、1 张 `unmatched`，缺失序号为 `02`、`04`、`18`，`06_.jpg` 建议绑定 06 号同学；照片导入清单、图片规格汇总和已绑定照片 ZIP 导出均验证通过。
- 2026-07-10 Docker 镜像打包记录：`docker-compose.yml` 已为后端和前端增加稳定镜像名，默认 `QXBAN_PLATFORM=linux/arm64`，镜像分别为 `qxbanxiaozhu-backend:latest` 和 `qxbanxiaozhu-frontend:latest`。
- 新增 `scripts/build-docker-images.sh`：有 Docker daemon 时运行脚本会执行 `docker compose build`；加 `--save` 会导出 `dist/docker/qxbanxiaozhu-images-linux-arm64.tar`，方便拷贝到 N1 后用 `docker load -i` 导入。
- 某些开发环境可能没有 Docker 或无法连接部署设备；这时可先运行脚本导出镜像，再在目标设备导入并启动。
- 本地开发服务可用 `screen` 常驻启动，避免普通后台进程被终端会话回收；前端代理 `/api/v1/health` 到后端 `127.0.0.1:8000`。
- 停止本地开发服务可执行：`screen -S qxban-backend -X quit` 和 `screen -S qxban-frontend -X quit`。日志在 `.dev-logs/backend.log` 与 `.dev-logs/frontend.log`。
- 2026-07-10 照片管理继续完善：前端新增 `photoImportCanBind()`，让“需处理”筛选、绑定按钮和批量建议绑定共享同一可绑定规则；`rejected` 损坏图片即使有 `file_id/download_url`，也只保留在“全部”列表供下载排查，不再显示“绑定选中/绑定建议”按钮。
- 照片导入结果行现在通过 `photoImageSpecLabel()` 统一展示图片规格，损坏或不可读图片显示为“无法读取 · 未知”，与 `图片规格汇总` 表语义一致。
- 单张照片上传接口 `POST /api/v1/projects/{project_id}/photos/upload` 现在也会验证图片是否可读；扩展名合法但内容损坏时返回 400“图片文件无法读取，请检查图片是否损坏。”，并删除刚保存的临时上传文件记录，避免逐学生上传和批量导入行为不一致。
- 本次验证：`.venv/bin/pytest -q` 通过 10 个后端测试；`cd frontend && npm run test -- --run` 通过 3 个测试文件 26 个前端测试；`cd frontend && npm run build` 通过，仍只有 Vite 单 chunk 超过 500 kB 提示。已重启 `screen` 中的本地后端和前端服务，`127.0.0.1:5173` 与 `/api/v1/health` 均正常。
- 2026-07-10 Web 版“设置蓝底”已补齐：核心能力在 `qx_core.photos.create_blue_background_photo()`，先用 `rembg.remove()` 生成人物/主体透明前景，再合成项目蓝底 `#00acfd` PNG；测试中可注入 fake remover 验证蓝底合成，不依赖真实模型。
- 后端新增 `POST /api/v1/projects/{project_id}/photos/blue-background`，接收单张图片并返回蓝底 PNG 的 `FileOut`。如果 `rembg/onnxruntime` 未安装或 `QXBAN_PHOTO_BACKGROUND_ENABLED=0`，接口返回 503 明确提示；健康检查返回 `photo_background_enabled` 和 `photo_background_configured`。
- 前端“照片管理”单张照片区域新增“设置蓝底”按钮：处理成功后会用后端返回的蓝底 PNG 替换当前待裁剪照片，继续复用现有裁剪和绑定流程。
- 本地 `.venv` 可安装 `rembg==2.0.76` 与 `onnxruntime==1.27.0`；使用真实样本调用蓝底 API 成功，下载 PNG 尺寸为 `295 x 413`，左上角像素为 `(0, 172, 253)`。
- Docker 基础镜像仍默认不安装蓝底依赖；如需启用，使用 `QXBAN_INSTALL_PHOTO_BACKGROUND=1 docker compose up -d --build`。`U2NET_HOME` 固定为 `/app/data/rembg_models`，本地开发对应 `backend/.data/rembg_models`，避免模型在容器重建后反复下载。
- 2026-07-12 修复蓝底照片裁剪控件白屏问题：`裁剪缩放`、`左右`、`上下` 三个 range 控件不能在 `setCrop((current) => ...)` 的函数式更新里直接读取 `event.currentTarget.value`，否则 React 事件对象失效时会触发运行时异常，表现为页面刷新/白屏。现在先把数值读到局部变量，再调用 `updatePhotoCropSetting()` 更新状态。
- `frontend/src/photos.ts` 新增 `updatePhotoCropSetting()` 统一裁剪参数更新和边界裁剪，Vitest 已覆盖正常更新、越界裁剪和 `NaN` 回落；`rg` 已确认前端没有残留 `setState` 回调中读取 `event.currentTarget` 的危险写法。
- 本次验证：`cd frontend && npm run test -- --run src/photos.test.ts` 通过 15 个照片测试，`cd frontend && npm run test -- --run` 通过 3 个测试文件 27 个前端测试，`cd frontend && npm run build` 通过；`.venv/bin/pytest -q` 通过 11 个后端/核心测试。本地服务仍在 `screen` 中运行，`/api/v1/health` 返回 `photo_background_enabled=true`。
- 2026-07-12 N1 Docker 入口端口按用户要求改为默认 `5173`：`docker-compose.yml` 使用 `${QXBAN_HTTP_PORT:-5173}:80`，需要其它端口时只设置 `QXBAN_HTTP_PORT` 即可。
- N1 为 `aarch64` 低功耗设备，Docker Compose 部署需要为后端构建 ARM64 镜像，并把数据库、上传照片、导出文件和模型目录挂载到持久化卷。设备地址、网络、SSH 凭据和本地代理配置不应提交到仓库。
- 本次构建通过只允许 N1 地址访问的 Mac 临时 HTTP 代理完成；基础镜像由 Mac 使用 `crane` 下载 `linux/arm64` 版本后导入 N1。部署结束后临时代理应关闭，运行中的容器不依赖它。
- N1 蓝底功能启用 `rembg + onnxruntime`，模型改为轻量 `u2netp` 并由 `_photo_background_session()` 在后端进程内缓存。默认大模型 `u2net` 在 N1 上单次推理持续数分钟，不适合在线交互；`u2netp` 首次 API 预热实测约 6 分钟，预热后的第二次请求约 4.7 秒。模型路径为 `/data/qxbanxiaozhu/rembg_models/u2netp.onnx`，官方 MD5 为 `8e83ca70e441ab06c318d82300c84806`。
- 健康检查不能直接导入 `rembg`：`photo_background_available()` 使用 `importlib.util.find_spec()` 检查依赖，避免 N1 启动后 API 被重型导入阻塞。Nginx API 代理超时已提高到 600 秒，容纳首次模型预热。
- 2026-07-13 蓝底队列的任务记录保存在 SQLite，N1 容器或模型刚启动后的首个 `u2netp` 作业需要初始化 ONNX 会话，实测可能约 7 分钟；会话常驻后同类作业约 5 秒。该耗时不是队列卡死，作业完成状态、开始/结束时间和结果文件 ID 都可在 `photobackgroundjobrecord` 查询。
- 蓝底作业完成时，若用户始终停留在“照片管理”，前端会自动加载结果图并选中对应学生，允许继续裁剪缩放和“裁剪后绑定”。若用户切换页面或刷新，前端的临时作业状态会丢失；“最近活动”中高亮的成功活动现在提供“继续裁剪”入口，会重新打开照片管理并从持久化作业结果载入图片。
- 2026-07-13 宿舍贴右侧预览必须始终保留全部学生卡片；选中状态只决定 PDF 导出范围。未选卡片使用虚线、低透明度与加号图标表示，点击可重新加入导出，不能因为反选而从预览区域消失。学生查询刷新时要保留用户已作出的勾选/反选，只有首次进入某个班级时默认全选，并剔除已删除学生 ID。
- 蓝底作业的成功或失败结果有效期固定为 10 分钟：`backend.app.photo_jobs.cleanup_expired_photo_background_jobs()` 会删除关联活动、作业记录、原始上传文件和生成结果文件；`qxban-photo-cleanup` 轻量线程每 30 秒运行一次，因此无需等待下一次蓝底任务。队列中或运行中的作业不受此清理影响。结果过期后，前端轮询会提示用户重新提交。
- 2026-07-16 蓝底模型改为容器启动后后台预热：`qx_core.photos.prewarm_photo_background_session()` 使用内存中的 32 x 32 PNG 触发一次真实推理，不产生临时文件；`_photo_background_session()` 使用锁保护单例 ONNX 会话，避免预热和用户作业重复初始化。`backend.app.photo_jobs` 会在预热期间让作业保持 `queued`，确保 N1 只进行一次模型推理。
- 健康接口新增 `photo_background_warmup_status`（`disabled/warming/ready/failed`）和错误信息；照片管理页每 5 秒读取状态，预热期间显示“蓝底引擎预热中”并禁用设置蓝底按钮。可用 `QXBAN_PHOTO_BACKGROUND_PREWARM_ENABLED=0` 关闭自动预热，默认开启。
- 2026-07-13 部署验证：`/api/v1/health` 返回 `photo_background_enabled=true`，默认班级项目可读取；真实蓝底 API 连续两次返回 HTTP 200，测试文件、文件记录和活动记录随后已清理。磁盘清理后根分区约剩 865 MB。测试为 `.venv/bin/pytest -q` 12 passed、前端 Vitest 27 passed。
- 2026-07-13 修复“下载样表”在 Docker 中返回 404：`backend.app.main.resource_path()` 从 `/app/resources` 读取内置 `学生信息表样表.xlsx`，因此 `backend/Dockerfile` 必须包含 `COPY resources /app/resources`。N1 入口 `GET /api/v1/templates/student-info/download` 已验证返回 HTTP 200、正确的 XLSX content type 和可解压 Excel 文件；新增测试断言 Dockerfile 不会遗漏该资源。

## 演示素材记录

- 2026-07-16 根据 `resources/学生信息表样表.xlsx` 的 25 名学生生成了演示照片文件名，并下载了 25 张用于功能演示的示例头像到用户桌面目录 `学生照片-演示下载/`；文件名采用 `01_张三.jpg` 这类格式，可被照片匹配逻辑按姓名严格匹配。
- 演示头像来自 Random User Generator 的授权头像来源，仅用于演示，不代表真实学生身份；来源和每张图片 URL 保存在桌面目录的 `来源说明.json` 中。
- 2026-07-13 蓝底照片改为持久化单线程作业队列：`PhotoBackgroundJobRecord` 保存 `queued/running/succeeded/failed` 状态、输入和结果文件 ID；`backend.app.photo_jobs` 的唯一 worker 只领取一条作业，容器重启时会将 `running` 作业恢复为 `queued`。提交接口改为 `POST /projects/{project_id}/photos/blue-background`（multipart 需含 `student_id` 和 `file`），轮询接口为 `GET /projects/{project_id}/photos/blue-background/jobs/{job_id}`。
- 作业提交会写入“姓名蓝底设置已加入队列”活动；成功会写入 `level=success`、`detail.highlight=true` 的“姓名蓝底设置成功”活动，并带结果下载地址。前端每 3 秒查询当前蓝底作业、每 5 秒刷新最近活动；成功活动使用绿色高亮动画，结果会自动回填到裁剪区。作业进行中不能重复提交或绑定原图。
- N1 真实验证：临时班级连续提交两条作业，第一条 `running` 时第二条保持 `queued` 且 `queue_ahead_count=1`；首次模型加载后第一条成功，第二条只在前者完成后开始并约 4.6 秒完成。两条成功活动均含高亮标记，临时班级、照片、文件记录和作业记录均已清理。验证为 `.venv/bin/pytest -q` 13 passed、前端 Vitest 28 passed、前端生产构建通过。
- 2026-07-18 公开发布前已确认 GitHub 仓库为公开可见，`.gitignore` 会排除运行时数据、环境变量、Docker 镜像包和本地日志；部署设备地址、凭据和本机绝对路径不应进入提交。

## OpenAI Build Week 提交记录

- 2026-07-16 已核对 OpenAI Build Week Devpost 页面：项目需要使用 Codex 与 GPT-5.6 构建，截止时间页面显示为 2026-07-21 17:00 PT（中国大陆页面显示为 2026-07-22 08:00 GMT+8）。
- 可选择的赛道包括 Apps for your life、Work and productivity、Developer tools、Education；QX班小助当前最贴合 `Education`，也可从班主任/教务工作流角度评估 `Work and productivity`。
- 提交材料要求包括：可运行项目、项目描述、公开 YouTube 演示视频（少于 3 分钟，需讲解 Codex 与 GPT-5.6 的使用）、代码仓库 URL，以及包含安装/运行说明、示例数据和 Codex 工作流说明的 README；还需要填写主要开发工作的 `/feedback` Codex Session ID。
- 当前提交页面需要先登录 Devpost；未完成登录前不要创建新账号、选择第三方登录或提交表单。
