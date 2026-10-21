import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bed,
  Camera,
  Check,
  Download,
  FileSpreadsheet,
  History,
  Image,
  LayoutGrid,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  Upload
} from "lucide-react";
import { api, openDownload } from "./api";
import { AuthGate, AccountsPage } from "./Auth";
import type { User } from "./types";
import { isHighlightedActivity, resumablePhotoBackgroundJobId } from "./activities";
import {
  assignedStudentIdsForRooms,
  assignStudentToBed,
  type DormDragPayload,
  dormStudentOptionLabel,
  isStudentAssignedElsewhere,
  moveBedStudent,
  reorderBedWithinRoom
} from "./dorms";
import {
  addSeatToLayout,
  maxScalePercentForLayout,
  moveSeatLayout,
  normalizeSeatLayout,
  resizeSeatGrid,
  SEAT_EDGE_PADDING,
  SEAT_MOVE_STEP,
  SEAT_PAPER_HEIGHT,
  SEAT_PAPER_WIDTH,
  SEAT_SCALE_MIN_PERCENT,
  scaleSeatLayout,
  seatMetrics,
  seatTableFrame,
  snapSeatPosition
} from "./seats";
import {
  DEFAULT_PHOTO_CROP,
  DORM_PHOTO_HEIGHT,
  DORM_PHOTO_WIDTH,
  filterPhotoImportResults,
  filterPhotoRosterStudents,
  type PhotoCropSettings,
  type PhotoImportFilter,
  type PhotoRosterFilter,
  type PhotoSuggestedBind,
  PHOTO_BACKGROUND_COLOR,
  PHOTO_CROP_ZOOM_MAX,
  PHOTO_CROP_ZOOM_MIN,
  clearPhotoImportBindingForStudent,
  photoImageSpecSummary,
  photoImageSpecLabel,
  photoImportCanBind,
  photoImportFilterCounts,
  photoImportNeedsReview,
  photoImportSuggestedBinds,
  photoRosterFilterForGapStudent,
  photoSequenceGapStudentLabel,
  photoRosterFilterCounts,
  photoCropSourceRect,
  updatePhotoCropSetting
} from "./photos";
import type { Activity, DormRoom, FileResult, PhotoBackgroundJob, PhotoImportResult, PhotoSequenceGapStudent, Project, SeatLayout, Student, TabKey } from "./types";

const tabs: Array<{ key: TabKey; label: string; icon: typeof FileSpreadsheet }> = [
  { key: "students", label: "数据导入", icon: FileSpreadsheet },
  { key: "seats", label: "班级座位表", icon: LayoutGrid },
  { key: "dorms", label: "宿舍名单", icon: Bed },
  { key: "stickers", label: "宿舍贴", icon: Image },
  { key: "photos", label: "照片管理", icon: Camera }
];

const SEAT_AUTOSAVE_DELAY_SECONDS = 4;

function fileNameFromInput(event: React.ChangeEvent<HTMLInputElement>): File | null {
  return event.target.files?.[0] ?? null;
}

function filesFromInput(event: React.ChangeEvent<HTMLInputElement>): File[] {
  return Array.from(event.target.files ?? []);
}

function StatusLine({ text }: { text: string }) {
  if (!text) return null;
  return <div className="status-line">{text}</div>;
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ActivityPanel({
  activities,
  isLoading,
  onRefresh,
  onResumeBlueBackgroundJob
}: {
  activities: Activity[];
  isLoading: boolean;
  onRefresh: () => void;
  onResumeBlueBackgroundJob: (jobId: string) => void;
}) {
  return (
    <section className="activity-panel">
      <div className="activity-head">
        <div>
          <h2>最近活动</h2>
          <p>{isLoading ? "正在读取" : activities.length ? `${activities.length} 条记录` : "暂无记录"}</p>
        </div>
        <button className="icon-button" title="刷新最近活动" onClick={onRefresh}>
          <History size={17} />
        </button>
      </div>
      <div className="activity-list">
        {activities.map((activity) => {
          const resumableJobId = resumablePhotoBackgroundJobId(activity);
          return (
            <div className={`activity-item ${activity.level} ${isHighlightedActivity(activity) ? "highlight" : ""}`} key={activity.id}>
              <span>{formatActivityTime(activity.created_at)}</span>
              <strong>{activity.message}</strong>
              {resumableJobId && (
                <button className="text-button compact activity-item-action" type="button" onClick={() => onResumeBlueBackgroundJob(resumableJobId)}>
                  <ArrowRight size={14} />
                  继续裁剪
                </button>
              )}
            </div>
          );
        })}
        {!activities.length && !isLoading && <div className="empty-mini">完成操作后会显示在这里</div>}
      </div>
    </section>
  );
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取照片"));
    };
    image.src = url;
  });
}

async function createCroppedPhotoFile(file: File, crop: PhotoCropSettings): Promise<File> {
  const image = await loadImageFromFile(file);
  const rect = photoCropSourceRect(image.naturalWidth, image.naturalHeight, crop);
  const canvas = document.createElement("canvas");
  canvas.width = DORM_PHOTO_WIDTH;
  canvas.height = DORM_PHOTO_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持照片裁剪");
  context.fillStyle = PHOTO_BACKGROUND_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("照片裁剪失败"));
    }, "image/png");
  });
  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${baseName}-sticker.png`, { type: "image/png" });
}

async function fileFromDownload(file: FileResult, fallbackName: string): Promise<File> {
  const response = await fetch(file.download_url);
  if (!response.ok) throw new Error("蓝底照片下载失败");
  const blob = await response.blob();
  return new File([blob], file.filename || fallbackName, { type: blob.type || "image/png" });
}

function ClassSelector({
  projects,
  selectedProjectId,
  newClassName,
  isCreating,
  onSelect,
  onNameChange,
  onCreate
}: {
  projects: Project[];
  selectedProjectId: number | null;
  newClassName: string;
  isCreating: boolean;
  onSelect: (projectId: number) => void;
  onNameChange: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <form
      className="class-switcher"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate();
      }}
    >
      <select
        aria-label="选择班级"
        data-testid="class-select"
        value={selectedProjectId ?? ""}
        onChange={(event) => onSelect(Number(event.currentTarget.value))}
      >
        <option value="" disabled>
          选择班级
        </option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <input
        aria-label="新班级名称"
        data-testid="new-class-name"
        placeholder="新班级名称"
        value={newClassName}
        onChange={(event) => onNameChange(event.currentTarget.value)}
      />
      <button className="icon-button" data-testid="create-class" title="新建班级" type="submit" disabled={!newClassName.trim() || isCreating}>
        <Plus size={17} />
      </button>
    </form>
  );
}

function StudentsPage({ projectId, className, onStatus }: { projectId: number; className: string; onStatus: (value: string) => void }) {
  const queryClient = useQueryClient();
  const [newStudent, setNewStudent] = useState({ name: "", hometown: "", class_name: className, source_area: "" });
  const studentsQuery = useQuery({ queryKey: ["students", projectId], queryFn: () => api.students(projectId) });

  useEffect(() => {
    setNewStudent({ name: "", hometown: "", class_name: className, source_area: "" });
  }, [projectId, className]);

  const importMutation = useMutation({
    mutationFn: (file: File) => api.importStudents(projectId, file),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      queryClient.invalidateQueries({ queryKey: ["seats", projectId] });
      onStatus(`已导入 ${result.imported_count} 名学生`);
    },
    onError: (error) => onStatus(error.message)
  });
  const createMutation = useMutation({
    mutationFn: () => api.createStudent(projectId, { ...newStudent, class_name: className }),
    onSuccess: (student) => {
      setNewStudent({ name: "", hometown: "", class_name: className, source_area: "" });
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      queryClient.invalidateQueries({ queryKey: ["seats", projectId] });
      queryClient.invalidateQueries({ queryKey: ["dorms", projectId] });
      onStatus(`已新增 ${student.name}`);
    },
    onError: (error) => onStatus(error.message)
  });
  const attachPhotoMutation = useMutation({
    mutationFn: async ({ student, file }: { student: Student; file: File }) => {
      const uploaded = await api.uploadPhoto(projectId, file);
      return api.attachPhoto(projectId, student.id, uploaded.file_id);
    },
    onSuccess: (student) => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      onStatus(`已绑定 ${student.name} 的照片`);
    },
    onError: (error) => onStatus(error.message)
  });
  const patchMutation = useMutation({
    mutationFn: ({ student, patch }: { student: Student; patch: Partial<Pick<Student, "name" | "hometown" | "class_name" | "source_area">> }) =>
      api.patchStudent(projectId, student.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      queryClient.invalidateQueries({ queryKey: ["seats", projectId] });
    },
    onError: (error) => onStatus(error.message)
  });
  const deleteMutation = useMutation({
    mutationFn: (student: Student) => api.deleteStudent(projectId, student.id),
    onSuccess: (_result, student) => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      queryClient.invalidateQueries({ queryKey: ["seats", projectId] });
      queryClient.invalidateQueries({ queryKey: ["dorms", projectId] });
      onStatus(`已删除 ${student.name}`);
    },
    onError: (error) => onStatus(error.message)
  });
  const exportMutation = useMutation({
    mutationFn: () => api.exportStudents(projectId),
    onSuccess: (file) => openDownload(file),
    onError: (error) => onStatus(error.message)
  });

  const students = studentsQuery.data ?? [];
  const photoBoundCount = students.filter((student) => student.photo_url).length;
  const missingHometownCount = students.filter((student) => !student.hometown.trim()).length;

  return (
    <section className="workspace-grid">
      <div className="tool-panel wide">
        <div className="panel-heading">
          <h2>学生信息</h2>
          <div className="actions">
            <button className="icon-button" title="下载学生信息样表" onClick={() => window.open(api.studentInfoTemplateUrl(), "_blank", "noopener,noreferrer")}>
              <FileSpreadsheet size={17} />
            </button>
            <label className="icon-button" title="导入 Excel">
              <Upload size={17} />
              <input
                type="file"
                accept=".xlsx,.xlsm"
                onChange={(event) => {
                  const file = fileNameFromInput(event);
                  if (file) importMutation.mutate(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button className="icon-button" title="导出 Excel" onClick={() => exportMutation.mutate()} disabled={!students.length}>
              <Download size={17} />
            </button>
          </div>
        </div>
        <div className="student-overview">
          <div>
            <strong>{students.length}</strong>
            <span>学生总数</span>
          </div>
          <div>
            <strong>{photoBoundCount}</strong>
            <span>已绑定照片</span>
          </div>
          <div>
            <strong>{missingHometownCount}</strong>
            <span>籍贯待补</span>
          </div>
          <div>
            <strong>{className}</strong>
            <span>当前班级</span>
          </div>
        </div>
        <div className="workflow-strip">
          <button type="button" onClick={() => window.open(api.studentInfoTemplateUrl(), "_blank", "noopener,noreferrer")}>
            <span>1</span>
            下载样表
          </button>
          <label>
            <span>2</span>
            导入名单
            <input
              type="file"
              accept=".xlsx,.xlsm"
              onChange={(event) => {
                const file = fileNameFromInput(event);
                if (file) importMutation.mutate(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button type="button" onClick={() => onStatus("可在照片列逐个上传，也可进入“照片管理”页集中绑定。")}>
            <span>3</span>
            绑定照片
          </button>
          <button type="button" disabled={!students.length} onClick={() => exportMutation.mutate()}>
            <span>4</span>
            导出更新表
          </button>
        </div>
        <form
          className="manual-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (newStudent.name.trim()) createMutation.mutate();
          }}
        >
          <input
            aria-label="学生姓名"
            data-testid="new-student-name"
            placeholder="姓名"
            value={newStudent.name}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setNewStudent((current) => ({ ...current, name: value }));
            }}
          />
          <input
            aria-label="学生籍贯"
            data-testid="new-student-hometown"
            placeholder="籍贯"
            value={newStudent.hometown}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setNewStudent((current) => ({ ...current, hometown: value }));
            }}
          />
          <input
            aria-label="学生班级"
            data-testid="new-student-class"
            placeholder="班级"
            value={newStudent.class_name}
            readOnly
          />
          <input aria-label="学生送生区" data-testid="new-student-source-area" placeholder="送生区"
            value={newStudent.source_area} onChange={(event) => {
              const value = event.currentTarget.value;
              setNewStudent((current) => ({ ...current, source_area: value }));
            }} />
          <button
            className="primary-action add-student-action"
            data-testid="new-student-submit"
            type="submit"
            disabled={!newStudent.name.trim() || createMutation.isPending}
          >
            <Plus size={18} />
            新增学生
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>序号</th>
                <th>姓名</th>
                <th>籍贯</th>
                <th>班级</th>
                <th>送生区</th>
                <th>照片</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id} data-testid={`student-row-${student.id}`}>
                  <td>{student.index}</td>
                  <td>
                    <input
                      defaultValue={student.name}
                      onBlur={(event) => {
                        if (event.currentTarget.value !== student.name) {
                          patchMutation.mutate({ student, patch: { name: event.currentTarget.value } });
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={student.hometown}
                      onBlur={(event) => {
                        if (event.currentTarget.value !== student.hometown) {
                          patchMutation.mutate({ student, patch: { hometown: event.currentTarget.value } });
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${student.name} 所在班级`}
                      value={className}
                      readOnly
                    />
                  </td>
                  <td>
                    <input aria-label={`${student.name} 送生区`} key={`area-${student.id}-${student.source_area}`}
                      defaultValue={student.source_area} onBlur={(event) => {
                        if (event.currentTarget.value !== student.source_area) {
                          patchMutation.mutate({ student, patch: { source_area: event.currentTarget.value } });
                        }
                      }} />
                  </td>
                  <td>
                    <div className="photo-cell">
                      <span>{student.photo_url ? "已绑定" : student.photo_match_status}</span>
                      <label className="icon-button" title={`上传 ${student.name} 的照片`}>
                        <Camera size={16} />
                        <input
                          type="file"
                          accept=".png,.jpg,.jpeg,.bmp,.webp"
                          disabled={attachPhotoMutation.isPending}
                          onChange={(event) => {
                            const file = fileNameFromInput(event);
                            if (file) attachPhotoMutation.mutate({ student, file });
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </td>
                  <td className="row-actions">
                    <button
                      className="icon-button danger"
                      data-testid={`delete-student-${student.id}`}
                      title="删除学生"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`删除学生「${student.name}」？`)) {
                          deleteMutation.mutate(student);
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!students.length && (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    暂无学生
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function cloneLayout(layout: SeatLayout): SeatLayout {
  return JSON.parse(JSON.stringify(layout)) as SeatLayout;
}

function SeatCanvas({
  layout,
  selectedSeatIndex,
  onSelectSeat,
  onChange
}: {
  layout: SeatLayout;
  selectedSeatIndex: number | null;
  onSelectSeat: (index: number | null) => void;
  onChange: (layout: SeatLayout, selectedSeatIndex?: number | null) => void;
}) {
  const paperScale = 0.76;
  const metrics = seatMetrics(layout);
  const frame = seatTableFrame(layout);
  const fontScale = Math.max(0.78, Math.min(metrics.scaleFactor, 2.1));
  const titleFontSize = Math.max(16, Math.min(30, 22 * fontScale));
  const labelFontSize = Math.max(10, Math.min(18, 12 * fontScale));
  const nameFontSize = Math.max(10, Math.min(22, 12 * fontScale));
  const platformFontSize = Math.max(15, Math.min(28, 18 * fontScale));
  const stageWidth = SEAT_PAPER_WIDTH * paperScale;
  const stageHeight = SEAT_PAPER_HEIGHT * paperScale;
  const seats = layout.seats ?? [];
  const safetyInset = SEAT_EDGE_PADDING * paperScale;
  const guideLeft = safetyInset;
  const guideTop = safetyInset;
  const guideRight = stageWidth - safetyInset;
  const guideBottom = stageHeight - safetyInset;
  return (
    <Stage width={stageWidth} height={stageHeight} className="seat-stage" onMouseDown={(event) => event.target === event.target.getStage() && onSelectSeat(null)}>
      <Layer>
        <Rect
          x={0}
          y={0}
          width={stageWidth}
          height={stageHeight}
          fill="#ffffff"
          stroke="#cbd5e1"
          strokeWidth={1.4}
          shadowColor="rgba(15, 23, 42, 0.18)"
          shadowBlur={18}
          shadowOffset={{ x: 0, y: 10 }}
          onClick={() => onSelectSeat(null)}
          onTap={() => onSelectSeat(null)}
        />
        <Line points={[guideLeft, guideTop, guideRight, guideTop]} stroke="#dbe7f3" strokeWidth={1} dash={[7, 6]} listening={false} />
        <Line points={[guideRight, guideTop, guideRight, guideBottom]} stroke="#dbe7f3" strokeWidth={1} dash={[7, 6]} listening={false} />
        <Line points={[guideRight, guideBottom, guideLeft, guideBottom]} stroke="#dbe7f3" strokeWidth={1} dash={[7, 6]} listening={false} />
        <Line points={[guideLeft, guideBottom, guideLeft, guideTop]} stroke="#dbe7f3" strokeWidth={1} dash={[7, 6]} listening={false} />
        {Array.from({ length: layout.columns + 1 }).map((_, column) => {
          const x = (frame.left + column * metrics.cellWidth) * paperScale;
          return (
            <Line
              key={`grid-x-${column}`}
              points={[x, frame.top * paperScale, x, frame.platformTop * paperScale]}
              stroke="#edf2f7"
              strokeWidth={1}
              listening={false}
            />
          );
        })}
        {Array.from({ length: layout.rows + 1 }).map((_, row) => {
          const y = (frame.top + row * metrics.cellHeight) * paperScale;
          return (
            <Line
              key={`grid-y-${row}`}
              points={[frame.left * paperScale, y, (frame.left + frame.width) * paperScale, y]}
              stroke="#edf2f7"
              strokeWidth={1}
              listening={false}
            />
          );
        })}
        <Rect
          x={frame.left * paperScale}
          y={(frame.top - metrics.titleOffset) * paperScale}
          width={frame.width * paperScale}
          height={(frame.seatHeight + frame.platformHeight + metrics.titleOffset) * paperScale}
          stroke="#bfdbfe"
          strokeWidth={1}
          dash={[8, 6]}
          listening={false}
        />
        <Text
          text={layout.title_text || "班级座位表"}
          x={frame.left * paperScale}
          y={(frame.top - metrics.titleOffset) * paperScale}
          width={frame.width * paperScale}
          align="center"
          fontSize={titleFontSize}
          fontStyle="bold"
          fill="#111827"
        />
        {Array.from({ length: layout.columns }).map((_, column) => (
          <Text
            key={`column-${column}`}
            text={`第 ${column + 1} 组`}
            x={(frame.left + column * metrics.cellWidth) * paperScale}
            y={(frame.top - 34 * metrics.scaleFactor) * paperScale}
            width={metrics.cellWidth * paperScale}
            align="center"
            fontSize={labelFontSize}
            fill="#374151"
          />
        ))}
        {layout.row_label_position !== "none" &&
          Array.from({ length: layout.rows }).map((_, row) => (
            <Text
              key={`row-${row}`}
              text={`第 ${layout.rows - row} 排`}
              x={(layout.row_label_position === "right" ? frame.left + frame.width + 16 * metrics.scaleFactor : frame.left - 70 * metrics.scaleFactor) * paperScale}
              y={(frame.top + row * metrics.cellHeight + 15 * metrics.scaleFactor) * paperScale}
              width={54 * metrics.scaleFactor * paperScale}
              align="center"
              fontSize={labelFontSize}
              fill="#374151"
            />
          ))}
        {seats.map((seat, index) => (
          <Group
            key={`${seat.name}-${index}`}
            x={seat.x * paperScale}
            y={seat.y * paperScale}
            draggable
            onClick={() => onSelectSeat(index)}
            onTap={() => onSelectSeat(index)}
            dragBoundFunc={(position) => {
              const next = snapSeatPosition(layout, position.x / paperScale, position.y / paperScale);
              return { x: next.x * paperScale, y: next.y * paperScale };
            }}
            onDragEnd={(event) => {
              const nextPosition = snapSeatPosition(layout, event.target.x() / paperScale, event.target.y() / paperScale);
              const nextSeats = seats.map((item, seatIndex) =>
                seatIndex === index ? { ...item, x: Math.round(nextPosition.x * 100) / 100, y: Math.round(nextPosition.y * 100) / 100 } : item
              );
              onChange({ ...layout, seats: nextSeats }, index);
            }}
          >
            <Rect
              width={metrics.cellWidth * paperScale}
              height={metrics.cellHeight * paperScale}
              fill={selectedSeatIndex === index ? "#dbeafe" : seat.name ? "#ffffff" : "#f8fafc"}
              stroke={selectedSeatIndex === index ? "#2563eb" : "#111827"}
              strokeWidth={selectedSeatIndex === index ? 2 : 1}
              cornerRadius={2}
              shadowColor={selectedSeatIndex === index ? "rgba(37, 99, 235, 0.28)" : "rgba(15, 23, 42, 0.08)"}
              shadowBlur={selectedSeatIndex === index ? 8 : 3}
              shadowOffset={{ x: 0, y: selectedSeatIndex === index ? 3 : 1 }}
            />
            <Text
              text={seat.name}
              x={3 * fontScale}
              y={metrics.cellHeight * paperScale / 2 - nameFontSize / 2}
              width={metrics.cellWidth * paperScale - 6 * fontScale}
              align="center"
              fontSize={nameFontSize}
              fill="#111827"
              listening={false}
              wrap="none"
              ellipsis
            />
          </Group>
        ))}
        <Rect
          x={frame.left * paperScale}
          y={frame.platformTop * paperScale}
          width={frame.width * paperScale}
          height={frame.platformHeight * paperScale}
          fill="#ffffff"
          stroke="#111827"
          strokeWidth={1}
        />
        <Text
          text="讲台"
          x={frame.left * paperScale}
          y={frame.platformTop * paperScale + (frame.platformHeight * paperScale - platformFontSize) / 2}
          width={frame.width * paperScale}
          align="center"
          fontSize={platformFontSize}
          fill="#111827"
        />
      </Layer>
    </Stage>
  );
}

function SeatsPage({ projectId, onStatus }: { projectId: number; onStatus: (value: string) => void }) {
  const queryClient = useQueryClient();
  const seatsQuery = useQuery({ queryKey: ["seats", projectId], queryFn: () => api.seats(projectId) });
  const [layout, setLayout] = useState<SeatLayout | null>(null);
  const [selectedSeatIndex, setSelectedSeatIndex] = useState<number | null>(null);
  const [undoStack, setUndoStack] = useState<SeatLayout[]>([]);
  const [redoStack, setRedoStack] = useState<SeatLayout[]>([]);
  const [autosaveRemaining, setAutosaveRemaining] = useState<number | null>(null);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const autosaveIntervalRef = useRef<number | null>(null);
  const pendingAutosaveLayoutRef = useRef<SeatLayout | null>(null);

  function clearAutosaveTimers(updateNotice = true) {
    if (autosaveTimeoutRef.current !== null) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
    if (autosaveIntervalRef.current !== null) {
      window.clearInterval(autosaveIntervalRef.current);
      autosaveIntervalRef.current = null;
    }
    pendingAutosaveLayoutRef.current = null;
    if (updateNotice) setAutosaveRemaining(null);
  }

  const saveMutation = useMutation({
    mutationFn: (nextLayout: SeatLayout) => api.saveSeats(projectId, normalizeSeatLayout(nextLayout)),
    onSuccess: (result) => {
      const normalized = normalizeSeatLayout(result.layout);
      if (!pendingAutosaveLayoutRef.current) {
        setLayout(normalized);
        queryClient.setQueryData(["seats", projectId], { layout: normalized });
      }
      onStatus("座位表已保存到数据库");
    },
    onError: (error) => onStatus(error.message)
  });

  function scheduleAutosave(nextLayout: SeatLayout) {
    const normalized = normalizeSeatLayout(nextLayout);
    clearAutosaveTimers();
    pendingAutosaveLayoutRef.current = normalized;
    setAutosaveRemaining(SEAT_AUTOSAVE_DELAY_SECONDS);
    autosaveIntervalRef.current = window.setInterval(() => {
      setAutosaveRemaining((current) => (current && current > 1 ? current - 1 : current));
    }, 1000);
    autosaveTimeoutRef.current = window.setTimeout(() => {
      if (autosaveIntervalRef.current !== null) {
        window.clearInterval(autosaveIntervalRef.current);
        autosaveIntervalRef.current = null;
      }
      autosaveTimeoutRef.current = null;
      setAutosaveRemaining(null);
      const pendingLayout = pendingAutosaveLayoutRef.current;
      pendingAutosaveLayoutRef.current = null;
      if (pendingLayout) saveMutation.mutate(pendingLayout);
    }, SEAT_AUTOSAVE_DELAY_SECONDS * 1000);
  }

  function saveLayoutImmediately(nextLayout: SeatLayout) {
    clearAutosaveTimers();
    saveMutation.mutate(nextLayout);
  }

  useEffect(() => {
    if (seatsQuery.data?.layout) {
      clearAutosaveTimers();
      setLayout(normalizeSeatLayout(seatsQuery.data.layout));
      setSelectedSeatIndex(null);
      setUndoStack([]);
      setRedoStack([]);
    }
  }, [seatsQuery.data, projectId]);

  useEffect(() => () => clearAutosaveTimers(false), []);

  function commitLayout(nextLayout: SeatLayout, nextSelectedSeatIndex: number | null = selectedSeatIndex) {
    if (!layout) return;
    const versionedLayout = normalizeSeatLayout({ ...nextLayout, version: Math.max(nextLayout.version ?? 3, 3) });
    setUndoStack((current) => [...current.slice(-2), cloneLayout(layout)]);
    setRedoStack([]);
    setSelectedSeatIndex(nextSelectedSeatIndex);
    setLayout(versionedLayout);
    scheduleAutosave(versionedLayout);
  }

  function undoLayout() {
    if (!layout || !undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current.slice(-2), cloneLayout(layout)]);
    setSelectedSeatIndex(null);
    setLayout(previous);
    scheduleAutosave(previous);
  }

  function redoLayout() {
    if (!layout || !redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current.slice(-2), cloneLayout(layout)]);
    setSelectedSeatIndex(null);
    setLayout(next);
    scheduleAutosave(next);
  }

  const selectedSeat = selectedSeatIndex !== null ? layout?.seats[selectedSeatIndex] : null;

  const resetMutation = useMutation({
    mutationFn: () => api.resetSeats(projectId),
    onSuccess: (result) => {
      clearAutosaveTimers();
      const normalized = normalizeSeatLayout(result.layout);
      setLayout(normalized);
      queryClient.setQueryData(["seats", projectId], { layout: normalized });
      setSelectedSeatIndex(null);
      setUndoStack([]);
      setRedoStack([]);
      onStatus("座位表已重置");
    },
    onError: (error) => onStatus(error.message)
  });
  const exportMutation = useMutation({
    mutationFn: () => api.exportSeats(projectId),
    onSuccess: (file) => openDownload(file),
    onError: (error) => onStatus(error.message)
  });
  const namedSeatCount = layout?.seats.filter((seat) => seat.name.trim()).length ?? 0;
  const totalSeatCount = layout?.seats.length ?? 0;
  const emptySeatCount = Math.max(0, totalSeatCount - namedSeatCount);
  const scaleMax = layout ? Math.floor(maxScalePercentForLayout(layout.rows, layout.columns, layout.row_label_position)) : 100;
  const saveStateText =
    autosaveRemaining !== null
      ? `自动保存 ${autosaveRemaining}s`
      : saveMutation.isPending
        ? "保存中"
        : "已同步";

  return (
    <section className="seat-workspace">
      <div className="seat-page-head">
        <div>
          <h2>班级座位表</h2>
          <p>{layout ? `${layout.rows} 行 x ${layout.columns} 列 · ${totalSeatCount} 个座位 · ${namedSeatCount} 个姓名` : "正在读取座位表"}</p>
        </div>
        <div className="actions">
          <button className="icon-button" title="重置座位表" disabled={resetMutation.isPending} onClick={() => resetMutation.mutate()}>
            <RefreshCw size={17} />
          </button>
          <button className="icon-button" title="保存座位表" disabled={!layout || saveMutation.isPending} onClick={() => layout && saveLayoutImmediately(layout)}>
            <Save size={17} />
          </button>
          <button className="icon-button" title="导出 PDF" disabled={!layout || exportMutation.isPending} onClick={() => exportMutation.mutate()}>
            <Download size={17} />
          </button>
        </div>
      </div>
      {layout ? (
        <div className="seat-editor-grid">
          <aside className="seat-inspector">
            <section className="inspector-section">
              <h3>纸面</h3>
              <label className="field-block">
                <span>标题</span>
                <input
                  key={`title-${layout.title_text}`}
                  aria-label="座位表标题"
                  defaultValue={layout.title_text || "班级座位表"}
                  onBlur={(event) => {
                    const title = event.currentTarget.value.trim() || "班级座位表";
                    if (title !== layout.title_text) commitLayout({ ...layout, title_text: title });
                  }}
                />
              </label>
              <div className="compact-fields">
                <label className="field-block">
                  <span>行数</span>
                  <input
                    aria-label="座位表行数"
                    type="number"
                    min={1}
                    max={12}
                    value={layout.rows}
                    onChange={(event) => commitLayout(resizeSeatGrid(layout, Number(event.currentTarget.value), layout.columns), null)}
                  />
                </label>
                <label className="field-block">
                  <span>列数</span>
                  <input
                    aria-label="座位表列数"
                    type="number"
                    min={1}
                    max={12}
                    value={layout.columns}
                    onChange={(event) => commitLayout(resizeSeatGrid(layout, layout.rows, Number(event.currentTarget.value)), null)}
                  />
                </label>
              </div>
              <label className="field-block">
                <span>座位表宽度</span>
                <div className="range-row">
                  <input
                    aria-label="座位表占 A4 纸宽百分比"
                    type="range"
                    min={SEAT_SCALE_MIN_PERCENT}
                    max={scaleMax}
                    value={Math.round(layout.scale_percent ?? 0)}
                    onChange={(event) => commitLayout(scaleSeatLayout(layout, Number(event.currentTarget.value)), selectedSeatIndex)}
                  />
                  <strong>{Math.round(layout.scale_percent ?? 0)}%</strong>
                </div>
              </label>
              <label className="field-block">
                <span>排标注</span>
                <select
                  aria-label="排标注位置"
                  value={layout.row_label_position}
                  onChange={(event) => {
                    const rowLabelPosition = event.currentTarget.value as SeatLayout["row_label_position"];
                    commitLayout(scaleSeatLayout({ ...layout, row_label_position: rowLabelPosition }, layout.scale_percent ?? 0), selectedSeatIndex);
                  }}
                >
                  <option value="left">左侧</option>
                  <option value="right">右侧</option>
                  <option value="none">不显示</option>
                </select>
              </label>
            </section>

            <section className="inspector-section">
              <h3>选中座位</h3>
              <label className="field-block">
                <span>{selectedSeatIndex === null ? "未选择" : `第 ${selectedSeatIndex + 1} 个`}</span>
                <input
                  key={`seat-${selectedSeatIndex}-${selectedSeat?.name ?? ""}`}
                  aria-label="选中座位姓名"
                  placeholder="姓名"
                  disabled={selectedSeatIndex === null}
                  defaultValue={selectedSeat?.name ?? ""}
                  onBlur={(event) => {
                    if (selectedSeatIndex === null) return;
                    const nextSeats = layout.seats.map((seat, index) => (index === selectedSeatIndex ? { ...seat, name: event.currentTarget.value.trim() || "新座位" } : seat));
                    commitLayout({ ...layout, seats: nextSeats }, selectedSeatIndex);
                  }}
                />
              </label>
              <div className="button-grid two">
                <button
                  className="text-button"
                  onClick={() => {
                    const result = addSeatToLayout(layout);
                    commitLayout(result.layout, result.seatIndex);
                  }}
                >
                  <Plus size={16} />
                  添加
                </button>
                <button
                  className="text-button danger"
                  disabled={selectedSeatIndex === null}
                  onClick={() => {
                    if (selectedSeatIndex === null) return;
                    commitLayout({ ...layout, seats: layout.seats.filter((_, index) => index !== selectedSeatIndex) }, null);
                  }}
                >
                  <Trash2 size={16} />
                  删除
                </button>
              </div>
            </section>

            <section className="inspector-section">
              <h3>整表移动</h3>
              <div className="move-pad">
                <span />
                <button className="icon-button" title="上移" onClick={() => commitLayout(moveSeatLayout(layout, 0, -SEAT_MOVE_STEP))}>
                  <ArrowUp size={17} />
                </button>
                <span />
                <button className="icon-button" title="左移" onClick={() => commitLayout(moveSeatLayout(layout, -SEAT_MOVE_STEP, 0))}>
                  <ArrowLeft size={17} />
                </button>
                <button className="icon-button" title="下移" onClick={() => commitLayout(moveSeatLayout(layout, 0, SEAT_MOVE_STEP))}>
                  <ArrowDown size={17} />
                </button>
                <button className="icon-button" title="右移" onClick={() => commitLayout(moveSeatLayout(layout, SEAT_MOVE_STEP, 0))}>
                  <ArrowRight size={17} />
                </button>
              </div>
            </section>

            <section className="inspector-section">
              <h3>历史</h3>
              <div className="button-grid two">
                <button className="text-button" disabled={!undoStack.length} onClick={undoLayout}>
                  <Undo2 size={16} />
                  上一步
                </button>
                <button className="text-button" disabled={!redoStack.length} onClick={redoLayout}>
                  <Redo2 size={16} />
                  下一步
                </button>
              </div>
            </section>
          </aside>

          <div className="seat-canvas-panel">
            <div className="seat-canvas-status">
              <div className="seat-stats">
                <span>横向 A4</span>
                <span>{Math.round(layout.scale_percent ?? 0)}%</span>
                <span>{emptySeatCount} 空座</span>
              </div>
              <span className={autosaveRemaining !== null ? "save-state pending" : "save-state"}>{saveStateText}</span>
            </div>
            <div className="seat-stage-wrap">
              <SeatCanvas layout={layout} selectedSeatIndex={selectedSeatIndex} onSelectSeat={setSelectedSeatIndex} onChange={commitLayout} />
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-panel">暂无座位表</div>
      )}
    </section>
  );
}

function DormsPage({ projectId, onStatus }: { projectId: number; onStatus: (value: string) => void }) {
  const queryClient = useQueryClient();
  const studentsQuery = useQuery({ queryKey: ["students", projectId], queryFn: () => api.students(projectId) });
  const dormsQuery = useQuery({ queryKey: ["dorms", projectId], queryFn: () => api.dorms(projectId) });
  const recentDormsQuery = useQuery({ queryKey: ["recent-dorm-rosters", projectId], queryFn: () => api.recentDormRosters(projectId) });
  const [rooms, setRooms] = useState<DormRoom[]>([]);
  const [dormTitle, setDormTitle] = useState("宿舍安排表");
  const [isDirty, setIsDirty] = useState(false);
  const [dragOverBed, setDragOverBed] = useState<string | null>(null);
  const students = studentsQuery.data ?? [];
  const recentDormRosters = recentDormsQuery.data ?? [];
  const assignedStudentIds = useMemo(() => assignedStudentIdsForRooms(rooms), [rooms]);
  const unassignedStudents = students.filter((student) => !assignedStudentIds.has(String(student.id)));
  const bedCount = rooms.reduce((total, room) => total + room.beds.length, 0);
  const assignedCount = rooms.reduce((total, room) => total + room.beds.filter(Boolean).length, 0);

  useEffect(() => {
    setRooms(dormsQuery.data?.rooms ?? []);
    setIsDirty(false);
  }, [dormsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => api.saveDorms(projectId, rooms),
    onSuccess: (result) => {
      queryClient.setQueryData(["dorms", projectId], result);
      setIsDirty(false);
      onStatus("宿舍名单已保存");
    },
    onError: (error) => onStatus(error.message)
  });
  const importMutation = useMutation({
    mutationFn: (file: File) => api.importDorms(projectId, file),
    onSuccess: (result) => {
      setRooms(result.rooms);
      queryClient.setQueryData(["dorms", projectId], { rooms: result.rooms });
      queryClient.invalidateQueries({ queryKey: ["recent-dorm-rosters", projectId] });
      setIsDirty(false);
      onStatus(`已读取 ${result.room_count} 个宿舍，匹配 ${result.matched_count} 名学生`);
    },
    onError: (error) => onStatus(error.message)
  });
  const restoreRecentMutation = useMutation({
    mutationFn: (fileId: string) => api.restoreRecentDormRoster(projectId, fileId),
    onSuccess: (result) => {
      setRooms(result.rooms);
      queryClient.setQueryData(["dorms", projectId], { rooms: result.rooms });
      setIsDirty(false);
      onStatus(`已从最近宿舍表恢复 ${result.room_count} 个宿舍，匹配 ${result.matched_count} 名学生`);
    },
    onError: (error) => onStatus(error.message)
  });
  const exportMutation = useMutation({
    mutationFn: () => api.exportDorms(projectId, dormTitle.trim() || "宿舍安排表"),
    onSuccess: (file) => {
      queryClient.invalidateQueries({ queryKey: ["recent-dorm-rosters", projectId] });
      openDownload(file);
    },
    onError: (error) => onStatus(error.message)
  });

  function updateRooms(updater: (current: DormRoom[]) => DormRoom[]) {
    setRooms((current) => updater(current));
    setIsDirty(true);
  }

  function updateRoom(index: number, next: DormRoom) {
    updateRooms((current) => current.map((room, roomIndex) => (roomIndex === index ? next : room)));
  }

  function encodeDormDrag(payload: DormDragPayload): string {
    return JSON.stringify(payload);
  }

  function readDormDrag(event: React.DragEvent): DormDragPayload | null {
    const raw = event.dataTransfer.getData("application/x-qx-dorm") || event.dataTransfer.getData("text/plain");
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw) as DormDragPayload;
      return payload.kind === "student" || payload.kind === "bed" ? payload : null;
    } catch {
      return null;
    }
  }

  function beginDormDrag(event: React.DragEvent, payload: DormDragPayload) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-qx-dorm", encodeDormDrag(payload));
    event.dataTransfer.setData("text/plain", encodeDormDrag(payload));
  }

  function handleBedDrop(event: React.DragEvent, roomIndex: number, bedIndex: number) {
    event.preventDefault();
    const payload = readDormDrag(event);
    setDragOverBed(null);
    if (!payload) return;
    updateRooms((current) => {
      if (payload.kind === "student") {
        return assignStudentToBed(current, payload.studentId, { roomIndex, bedIndex });
      }
      if (payload.roomIndex === roomIndex) {
        return reorderBedWithinRoom(current, roomIndex, payload.bedIndex, bedIndex);
      }
      return moveBedStudent(current, { roomIndex: payload.roomIndex, bedIndex: payload.bedIndex }, { roomIndex, bedIndex });
    });
  }

  function nextRoomNumber(current: DormRoom[]): string {
    const numericRooms = current.map((room) => Number(room.number)).filter((value) => Number.isFinite(value));
    return String((numericRooms.length ? Math.max(...numericRooms) : 500) + 1);
  }

  function addDormRoom() {
    updateRooms((current) => [...current, { number: nextRoomNumber(current), beds: [null] }]);
  }

  function assignStudentToNextBed(student: Student) {
    const studentId = String(student.id);
    if (assignedStudentIds.has(studentId)) return;
    updateRooms((current) => {
      if (!current.length) return [{ number: "501", beds: [studentId] }];
      const next = current.map((room) => ({ ...room, beds: room.beds.slice() }));
      for (const room of next) {
        const emptyIndex = room.beds.findIndex((bed) => !bed);
        if (emptyIndex >= 0) {
          room.beds[emptyIndex] = studentId;
          return next;
        }
      }
      next[0].beds.push(studentId);
      return next;
    });
  }

  return (
    <section className="dorm-workspace">
      <aside className="tool-panel dorm-sidebar">
        <div className="panel-heading">
          <h2>宿舍名单</h2>
          <span className={isDirty ? "save-state pending" : "save-state"}>{isDirty ? "未保存" : "已同步"}</span>
        </div>
        <div className="dorm-metrics">
          <div>
            <strong>{rooms.length}</strong>
            <span>宿舍</span>
          </div>
          <div>
            <strong>{bedCount}</strong>
            <span>床位</span>
          </div>
          <div>
            <strong>{assignedCount}</strong>
            <span>已安排</span>
          </div>
        </div>
        <label className="field-block">
          <span>导出标题</span>
          <input value={dormTitle} onChange={(event) => setDormTitle(event.currentTarget.value)} />
        </label>
        <div className="button-grid two">
          <button className="text-button" onClick={addDormRoom}>
            <Plus size={16} />
            添加宿舍
          </button>
          <label className="text-button">
            <Upload size={16} />
            读取宿舍表
            <input
              type="file"
              accept=".xlsx,.xlsm"
              onChange={(event) => {
                const file = fileNameFromInput(event);
                if (file) importMutation.mutate(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button className="text-button" disabled={saveMutation.isPending || !rooms.length} onClick={() => saveMutation.mutate()}>
            <Save size={16} />
            保存
          </button>
          <button className="text-button" disabled={exportMutation.isPending || !rooms.length} onClick={() => exportMutation.mutate()}>
            <Download size={16} />
            导出
          </button>
        </div>
        <div className="recent-roster-panel">
          <div className="mini-heading">
            <strong>最近宿舍表</strong>
            <span>{recentDormRosters.length}</span>
          </div>
          <div className="recent-roster-list">
            {recentDormRosters.map((file) => (
              <button
                key={file.file_id}
                className="recent-roster-item"
                disabled={restoreRecentMutation.isPending}
                onClick={() => restoreRecentMutation.mutate(file.file_id)}
              >
                <span>{file.filename}</span>
                <small>{new Date(file.created_at).toLocaleDateString("zh-CN")}</small>
              </button>
            ))}
            {!recentDormRosters.length && <div className="empty-mini">暂无记录</div>}
          </div>
        </div>
        <div className="unassigned-panel">
          <div className="mini-heading">
            <strong>未安排学生</strong>
            <span>{unassignedStudents.length}</span>
          </div>
          <div className="student-chip-list">
            {unassignedStudents.map((student) => (
              <button
                key={student.id}
                className="student-chip"
                draggable
                title="拖到床位，或点击分配到下一个空床位"
                onDragStart={(event) => beginDormDrag(event, { kind: "student", studentId: String(student.id) })}
                onClick={() => assignStudentToNextBed(student)}
              >
                <span>{student.name}</span>
                <small>{[student.hometown, student.source_area].filter(Boolean).join(" · ") || "未填写"}</small>
              </button>
            ))}
            {!unassignedStudents.length && <div className="empty-mini">学生已全部安排</div>}
          </div>
        </div>
      </aside>
      <div className="tool-panel dorm-board">
        <div className="panel-heading">
          <div>
            <h2>床位安排</h2>
            <p>{students.length ? `${students.length} 名学生，${Math.max(0, students.length - assignedCount)} 名未安排` : "请先导入学生名单"}</p>
          </div>
          <div className="actions">
            <button className="icon-button" title="添加宿舍" onClick={addDormRoom}>
              <Plus size={17} />
            </button>
          </div>
        </div>
        <div className="dorm-grid">
          {rooms.map((room, roomIndex) => (
            <div className="dorm-room" key={`${room.number}-${roomIndex}`}>
              <div className="dorm-room-head">
                <input aria-label="宿舍号" value={room.number} onChange={(event) => updateRoom(roomIndex, { ...room, number: event.currentTarget.value })} />
                <div className="row-actions">
                  <button className="icon-button" title="添加床位" onClick={() => updateRoom(roomIndex, { ...room, beds: [...room.beds, null] })}>
                    <Plus size={15} />
                  </button>
                  <button className="icon-button danger" title="删除宿舍" onClick={() => updateRooms((current) => current.filter((_, index) => index !== roomIndex))}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="beds">
                {room.beds.map((bed, bedIndex) => {
                  const bedKey = `${roomIndex}-${bedIndex}`;
                  return (
                  <div
                    className={`bed-row ${dragOverBed === bedKey ? "drop-target" : ""} ${bed ? "occupied" : "empty"}`}
                    key={`${room.number}-${bedIndex}`}
                    draggable={Boolean(bed)}
                    title={bed ? "拖动可调整床位" : "可拖入未安排学生"}
                    onDragStart={(event) => beginDormDrag(event, { kind: "bed", roomIndex, bedIndex, studentId: bed })}
                    onDragEnd={() => setDragOverBed(null)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverBed(bedKey);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragOverBed(null);
                      }
                    }}
                    onDrop={(event) => handleBedDrop(event, roomIndex, bedIndex)}
                  >
                    <span>{String(bedIndex + 1).padStart(2, "0")}</span>
                    <select
                      data-testid={`dorm-bed-select-${roomIndex}-${bedIndex}`}
                      value={bed ?? ""}
                      onChange={(event) => {
                        const beds = room.beds.slice();
                        beds[bedIndex] = event.currentTarget.value || null;
                        updateRoom(roomIndex, { ...room, beds });
                      }}
                    >
                      <option value="">空床位</option>
                      {students.map((student) => {
                        const studentId = String(student.id);
                        const isAssignedElsewhere = isStudentAssignedElsewhere(assignedStudentIds, bed, studentId);
                        return (
                          <option key={student.id} value={studentId} disabled={isAssignedElsewhere} className={isAssignedElsewhere ? "assigned-student-option" : ""}>
                            {dormStudentOptionLabel(student.name, [student.hometown, student.source_area].filter(Boolean).join(" / "), isAssignedElsewhere)}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      className="icon-button danger"
                      title="删除床位"
                      onClick={() => updateRoom(roomIndex, { ...room, beds: room.beds.filter((_, index) => index !== bedIndex) })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
                })}
              </div>
            </div>
          ))}
          {!rooms.length && <div className="empty-panel">暂无宿舍</div>}
        </div>
      </div>
    </section>
  );
}

function StickersPage({ projectId, onStatus }: { projectId: number; onStatus: (value: string) => void }) {
  const queryClient = useQueryClient();
  const studentsQuery = useQuery({ queryKey: ["students", projectId], queryFn: () => api.students(projectId) });
  const students = studentsQuery.data ?? [];
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [previewKind, setPreviewKind] = useState<"door" | "bed_cabinet">("door");
  const initializedSelectionProjectId = useRef<number | null>(null);
  useEffect(() => {
    if (!studentsQuery.isSuccess) return;
    if (initializedSelectionProjectId.current !== projectId) {
      initializedSelectionProjectId.current = projectId;
      setSelectedIds(students.map((student) => student.id));
      return;
    }
    const existingIds = new Set(students.map((student) => student.id));
    setSelectedIds((current) => current.filter((studentId) => existingIds.has(studentId)));
  }, [projectId, students, studentsQuery.isSuccess]);
  const exportMutation = useMutation({
    mutationFn: (kind: "door" | "bed_cabinet") => api.exportStickers(projectId, kind, selectedIds),
    onSuccess: (file) => openDownload(file),
    onError: (error) => onStatus(error.message)
  });
  const patchMutation = useMutation({
    mutationFn: ({ student, patch }: { student: Student; patch: Partial<Pick<Student, "name" | "hometown" | "class_name" | "source_area">> }) =>
      api.patchStudent(projectId, student.id, patch),
    onSuccess: (student) => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      queryClient.invalidateQueries({ queryKey: ["seats", projectId] });
      onStatus(`已更新 ${student.name}`);
    },
    onError: (error) => onStatus(error.message)
  });
  const renameProjectMutation = useMutation({
    mutationFn: (name: string) => api.updateProject(projectId, name),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      onStatus(`班级已更新为 ${project.name}`);
    },
    onError: (error) => onStatus(error.message)
  });
  const attachPhotoMutation = useMutation({
    mutationFn: async ({ student, file }: { student: Student; file: File }) => {
      const uploaded = await api.uploadPhoto(projectId, file);
      return api.attachPhoto(projectId, student.id, uploaded.file_id);
    },
    onSuccess: (student) => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      onStatus(`已替换 ${student.name} 的贴纸照片`);
    },
    onError: (error) => onStatus(error.message)
  });
  function toggleStudent(studentId: number) {
    setSelectedIds((current) =>
      current.includes(studentId) ? current.filter((item) => item !== studentId) : [...current, studentId]
    );
  }
  function updateStudentField(student: Student, field: "name" | "hometown" | "class_name" | "source_area", value: string) {
    const nextValue = value.trim();
    if (nextValue === student[field]) return;
    if (field === "class_name") {
      renameProjectMutation.mutate(nextValue);
      return;
    }
    patchMutation.mutate({ student, patch: { [field]: nextValue } });
  }
  return (
    <section className="stickers-workspace">
      <aside className="tool-panel">
        <div className="panel-heading">
          <h2>导出名单</h2>
          <div className="actions">
            <button className="text-button" onClick={() => setSelectedIds(students.map((student) => student.id))}>
              全选
            </button>
            <button className="text-button" onClick={() => setSelectedIds([])}>
              清空
            </button>
          </div>
        </div>
        <div className="sticker-summary">
          <strong>{selectedIds.length}</strong>
          <span>已选学生</span>
        </div>
        <div className="segmented-control">
          <button className={previewKind === "door" ? "active" : ""} onClick={() => setPreviewKind("door")}>
            门牌贴
          </button>
          <button className={previewKind === "bed_cabinet" ? "active" : ""} onClick={() => setPreviewKind("bed_cabinet")}>
            床柜贴
          </button>
        </div>
        <div className="check-list">
          {students.map((student) => (
            <label key={student.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(student.id)}
                onChange={(event) => {
                  setSelectedIds((current) =>
                    event.currentTarget.checked ? [...current, student.id] : current.filter((studentId) => studentId !== student.id)
                  );
                }}
              />
              <span>{student.name}</span>
              <small>{student.class_name || student.hometown}</small>
            </label>
          ))}
        </div>
      </aside>
      <div className="tool-panel sticker-preview-panel">
        <div className="panel-heading sticker-preview-heading">
          <div>
            <h2>{previewKind === "door" ? "宿舍门牌贴预览" : "床柜贴预览"}</h2>
            <p>{previewKind === "door" ? "包含照片、姓名、籍贯、班级、送生区" : "紧凑贴纸，适合床柜标签"}</p>
          </div>
          <div className="actions">
            <button className="primary-action" disabled={!selectedIds.length || exportMutation.isPending} onClick={() => exportMutation.mutate(previewKind)}>
              <Download size={18} />
              导出当前样式
            </button>
          </div>
        </div>
        <div className="sticker-preview-grid">
          {students.map((student) => {
            const isSelected = selectedIds.includes(student.id);
            return (
              <article key={student.id} className={`sticker-preview-card ${previewKind} ${isSelected ? "is-selected" : "is-excluded"}`}>
                <button
                  className="sticker-check"
                  type="button"
                  title={isSelected ? "取消选择，不导出该学生" : "选择该学生，加入导出"}
                  aria-label={isSelected ? `取消选择 ${student.name}` : `选择 ${student.name}`}
                  aria-pressed={isSelected}
                  onClick={() => toggleStudent(student.id)}
                >
                  {isSelected ? <Check size={15} /> : <Plus size={15} />}
                </button>
              <label className="sticker-photo" title={`替换 ${student.name} 的照片`}>
                {student.photo_url ? <img src={student.photo_url} alt={`${student.name}照片`} /> : <span>无照片</span>}
                <Camera size={16} className="sticker-photo-icon" />
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.bmp,.webp"
                  disabled={attachPhotoMutation.isPending}
                  onChange={(event) => {
                    const file = fileNameFromInput(event);
                    if (file) attachPhotoMutation.mutate({ student, file });
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <div className="sticker-lines">
                <label>
                  <span>姓名：</span>
                  <input
                    key={`sticker-name-${student.id}-${student.name}`}
                    defaultValue={student.name}
                    onBlur={(event) => updateStudentField(student, "name", event.currentTarget.value)}
                  />
                </label>
                <label>
                  <span>籍贯：</span>
                  <input
                    key={`sticker-hometown-${student.id}-${student.hometown}`}
                    defaultValue={student.hometown}
                    placeholder="未填写"
                    onBlur={(event) => updateStudentField(student, "hometown", event.currentTarget.value)}
                  />
                </label>
                {previewKind === "door" && (
                  <label>
                    <span>班级：</span>
                    <input
                      key={`sticker-class-${student.id}-${student.class_name}`}
                      defaultValue={student.class_name}
                      placeholder="未填写"
                      onBlur={(event) => updateStudentField(student, "class_name", event.currentTarget.value)}
                    />
                  </label>
                )}
                <label>
                  <span>送生区：</span>
                  <input key={`sticker-area-${student.id}-${student.source_area}`} defaultValue={student.source_area}
                    placeholder="未填写" onBlur={(event) => updateStudentField(student, "source_area", event.currentTarget.value)} />
                </label>
              </div>
            </article>
            );
          })}
          {!students.length && <div className="empty-panel">暂无学生</div>}
        </div>
        <div className="export-stack">
          <button className="primary-action" disabled={!selectedIds.length} onClick={() => exportMutation.mutate("door")}>
            <Download size={18} />
            宿舍门牌贴
          </button>
          <button className="primary-action secondary" disabled={!selectedIds.length} onClick={() => exportMutation.mutate("bed_cabinet")}>
            <Download size={18} />
            床柜贴
          </button>
        </div>
      </div>
    </section>
  );
}

function photoImportStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    strict: "精确",
    fuzzy: "模糊",
    unmatched: "未匹配",
    ambiguous: "多重匹配",
    duplicate: "重复",
    rejected: "已拒绝",
    manual: "手动"
  };
  return labels[status] ?? status;
}

function formatPhotoSequenceNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function PhotosPage({
  projectId,
  onStatus,
  resumeBlueBackgroundJobId,
  onResumeBlueBackgroundJobHandled
}: {
  projectId: number;
  onStatus: (value: string) => void;
  resumeBlueBackgroundJobId: string | null;
  onResumeBlueBackgroundJobHandled: () => void;
}) {
  const queryClient = useQueryClient();
  const studentsQuery = useQuery({ queryKey: ["students", projectId], queryFn: () => api.students(projectId) });
  const photoBackgroundHealthQuery = useQuery({
    queryKey: ["photo-background-health"],
    queryFn: api.health,
    refetchInterval: 5000
  });
  const students = studentsQuery.data ?? [];
  const [studentId, setStudentId] = useState<number | "">("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [crop, setCrop] = useState<PhotoCropSettings>(DEFAULT_PHOTO_CROP);
  const [bulkResults, setBulkResults] = useState<PhotoImportResult[]>([]);
  const [bulkFilter, setBulkFilter] = useState<PhotoImportFilter>("all");
  const [bulkMissingSequences, setBulkMissingSequences] = useState<number[]>([]);
  const [bulkSequenceGapStudents, setBulkSequenceGapStudents] = useState<PhotoSequenceGapStudent[]>([]);
  const [bulkReport, setBulkReport] = useState<FileResult | null>(null);
  const [rosterFilter, setRosterFilter] = useState<PhotoRosterFilter>("all");
  const [blueBackgroundJobId, setBlueBackgroundJobId] = useState<string | null>(null);
  const completedBlueJobIds = useRef(new Set<string>());
  const selectedStudent = students.find((student) => student.id === studentId) ?? null;
  const blueBackgroundJobQuery = useQuery({
    queryKey: ["photo-blue-background-job", projectId, blueBackgroundJobId],
    queryFn: () => api.photoBlueBackgroundJob(projectId, blueBackgroundJobId ?? ""),
    enabled: Boolean(blueBackgroundJobId),
    refetchInterval: blueBackgroundJobId ? 3000 : false
  });
  const blueBackgroundJob: PhotoBackgroundJob | undefined = blueBackgroundJobQuery.data;
  const photoBackgroundWarmupStatus = photoBackgroundHealthQuery.data?.photo_background_warmup_status;
  const photoBackgroundWarmupError = photoBackgroundHealthQuery.data?.photo_background_warmup_error;
  const photoBackgroundWarming = photoBackgroundWarmupStatus === "warming";

  useEffect(() => {
    setStudentId("");
    setPhoto(null);
    setCrop(DEFAULT_PHOTO_CROP);
    setBulkResults([]);
    setBulkFilter("all");
    setBulkMissingSequences([]);
    setBulkSequenceGapStudents([]);
    setBulkReport(null);
    setRosterFilter("all");
    setBlueBackgroundJobId(null);
    completedBlueJobIds.current.clear();
  }, [projectId]);

  useEffect(() => {
    if (!resumeBlueBackgroundJobId) return;
    completedBlueJobIds.current.delete(resumeBlueBackgroundJobId);
    setBlueBackgroundJobId(resumeBlueBackgroundJobId);
    onResumeBlueBackgroundJobHandled();
  }, [onResumeBlueBackgroundJobHandled, resumeBlueBackgroundJobId]);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (!blueBackgroundJobId || !blueBackgroundJobQuery.isError) return;
    setBlueBackgroundJobId(null);
    const message = blueBackgroundJobQuery.error instanceof Error ? blueBackgroundJobQuery.error.message : "蓝底作业状态读取失败";
    onStatus(message.includes("蓝底作业不存在") ? "蓝底结果已过期，请重新提交作业" : message);
  }, [blueBackgroundJobId, blueBackgroundJobQuery.error, blueBackgroundJobQuery.isError, onStatus]);

  useEffect(() => {
    if (!blueBackgroundJob || completedBlueJobIds.current.has(blueBackgroundJob.id)) return;
    if (blueBackgroundJob.status === "failed") {
      completedBlueJobIds.current.add(blueBackgroundJob.id);
      setBlueBackgroundJobId(null);
      onStatus(`${blueBackgroundJob.student_name}蓝底设置失败：${blueBackgroundJob.error_message || "请稍后重试"}`);
      queryClient.invalidateQueries({ queryKey: ["activities", projectId] });
      return;
    }
    if (blueBackgroundJob.status !== "succeeded" || !blueBackgroundJob.result) return;

    completedBlueJobIds.current.add(blueBackgroundJob.id);
    setBlueBackgroundJobId(null);
    queryClient.invalidateQueries({ queryKey: ["activities", projectId] });
    void fileFromDownload(blueBackgroundJob.result, `${blueBackgroundJob.student_name}-blue.png`)
      .then((processedPhoto) => {
        setStudentId(blueBackgroundJob.student_id);
        setPhoto(processedPhoto);
        setCrop(DEFAULT_PHOTO_CROP);
        onStatus(`${blueBackgroundJob.student_name}蓝底照片已生成，可继续裁剪绑定`);
      })
      .catch((error: Error) => onStatus(error.message));
  }, [blueBackgroundJob, onStatus, projectId, queryClient]);

  const attachMutation = useMutation({
    mutationFn: async () => {
      if (!studentId || !photo) throw new Error("请选择学生和照片");
      const croppedPhoto = await createCroppedPhotoFile(photo, crop);
      const uploaded = await api.uploadPhoto(projectId, croppedPhoto);
      return api.attachPhoto(projectId, Number(studentId), uploaded.file_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      if (studentId) {
        setBulkSequenceGapStudents((current) =>
          current.map((item) =>
            item.student_id === Number(studentId)
              ? { ...item, photo_bound: true, photo_match_status: "manual" }
              : item
          )
        );
      }
      setPhoto(null);
      setCrop(DEFAULT_PHOTO_CROP);
      onStatus("裁剪后的照片已绑定");
    },
    onError: (error) => onStatus(error.message)
  });
  const blueBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!studentId || !photo) throw new Error("请先选择学生和照片");
      return api.setPhotoBlueBackground(projectId, Number(studentId), photo);
    },
    onSuccess: (job) => {
      setBlueBackgroundJobId(job.id);
      const ahead = job.queue_ahead_count ? `前方还有 ${job.queue_ahead_count} 个作业，` : "";
      onStatus(`蓝底作业已加入队列，${ahead}请耐心等待。完成后会在最近活动中高亮提示。`);
      queryClient.invalidateQueries({ queryKey: ["activities", projectId] });
    },
    onError: (error) => onStatus(error.message)
  });
  const bulkImportMutation = useMutation({
    mutationFn: (files: File[]) => api.importPhotos(projectId, files),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      setBulkResults(result.results);
      setBulkFilter(result.results.some(photoImportNeedsReview) ? "needs_review" : "all");
      setBulkMissingSequences(result.missing_sequence_numbers ?? []);
      setBulkSequenceGapStudents(result.sequence_gap_students ?? []);
      setBulkReport(
        result.report_file_id && result.report_download_url
          ? {
              file_id: result.report_file_id,
              filename: result.report_filename ?? "照片导入核对清单.xlsx",
              download_url: result.report_download_url
            }
          : null
      );
      setRosterFilter("missing");
      onStatus(`照片批量导入完成：${result.matched_count} 张已匹配，${result.unmatched_count} 张未匹配`);
    },
    onError: (error) => onStatus(error.message)
  });
  const attachImportedPhotoMutation = useMutation({
    mutationFn: ({ fileId, targetStudentId }: { fileId: string; targetStudentId: number }) =>
      api.attachPhoto(projectId, targetStudentId, fileId),
    onSuccess: (student, variables) => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      setBulkSequenceGapStudents((current) =>
        current.map((item) =>
          item.student_id === variables.targetStudentId
            ? { ...item, photo_bound: true, photo_match_status: "manual" }
            : item
        )
      );
      setBulkResults((current) =>
        current.map((item) =>
          item.file_id === variables.fileId
            ? {
                ...item,
                status: "manual",
                message: "已手动绑定",
                student_id: student.id,
                student_name: student.name
              }
            : item
        )
      );
      onStatus(`已绑定 ${student.name} 的照片`);
    },
    onError: (error) => onStatus(error.message)
  });
  const attachSuggestedPhotosMutation = useMutation({
    mutationFn: async (binds: PhotoSuggestedBind[]) => {
      const bound: Array<PhotoSuggestedBind & { student: Student }> = [];
      for (const bind of binds) {
        const student = await api.attachPhoto(projectId, bind.targetStudentId, bind.fileId);
        bound.push({ ...bind, student });
      }
      return bound;
    },
    onSuccess: (bound) => {
      const boundByFileId = new Map(bound.map((item) => [item.fileId, item]));
      const targetStudentIds = new Set(bound.map((item) => item.targetStudentId));
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      setBulkSequenceGapStudents((current) =>
        current.map((item) =>
          targetStudentIds.has(item.student_id)
            ? { ...item, photo_bound: true, photo_match_status: "manual" }
            : item
        )
      );
      setBulkResults((current) =>
        current.map((item) => {
          const boundItem = item.file_id ? boundByFileId.get(item.file_id) : undefined;
          if (!boundItem) return item;
          return {
            ...item,
            status: "manual",
            message: "已按建议绑定",
            student_id: boundItem.student.id,
            student_name: boundItem.student.name
          };
        })
      );
      onStatus(`已按建议绑定 ${bound.length} 张照片`);
    },
    onError: (error) => onStatus(error.message)
  });
  const clearPhotoMutation = useMutation({
    mutationFn: (targetStudentId: number) => api.clearPhoto(projectId, targetStudentId),
    onSuccess: (student) => {
      queryClient.invalidateQueries({ queryKey: ["students", projectId] });
      setBulkSequenceGapStudents((current) =>
        current.map((item) =>
          item.student_id === student.id
            ? { ...item, photo_bound: false, photo_match_status: student.photo_match_status }
            : item
        )
      );
      setBulkResults((current) => clearPhotoImportBindingForStudent(current, student.id));
      setBulkFilter("needs_review");
      setRosterFilter("missing");
      onStatus(`已清除 ${student.name} 的照片`);
    },
    onError: (error) => onStatus(error.message)
  });
  const exportPhotosZipMutation = useMutation({
    mutationFn: () => api.exportPhotosZip(projectId),
    onSuccess: (file) => {
      openDownload(file);
      onStatus("已生成已绑定照片包");
    },
    onError: (error) => onStatus(error.message)
  });
  const exportPhotoStatusReportMutation = useMutation({
    mutationFn: () => api.exportPhotoStatusReport(projectId),
    onSuccess: (file) => {
      openDownload(file);
      onStatus("已生成照片状态清单");
    },
    onError: (error) => onStatus(error.message)
  });
  const boundCount = students.filter((student) => student.photo_url).length;
  const bulkFilterCounts = useMemo(() => photoImportFilterCounts(bulkResults), [bulkResults]);
  const suggestedBinds = useMemo(() => photoImportSuggestedBinds(bulkResults), [bulkResults]);
  const imageSpecSummary = useMemo(() => photoImageSpecSummary(bulkResults), [bulkResults]);
  const visibleBulkResults = useMemo(() => filterPhotoImportResults(bulkResults, bulkFilter), [bulkResults, bulkFilter]);
  const bulkMissingSequenceText = bulkMissingSequences.map(formatPhotoSequenceNumber).join("、");
  const rosterFilterCounts = useMemo(() => photoRosterFilterCounts(students), [students]);
  const visibleRosterStudents = useMemo(() => filterPhotoRosterStudents(students, rosterFilter), [students, rosterFilter]);
  const cropObjectPosition = `${50 + crop.offsetX / 2}% ${50 + crop.offsetY / 2}%`;
  return (
    <section className="photos-workspace">
      <div className="tool-panel">
        <div className="panel-heading">
          <h2>照片绑定</h2>
        </div>
        <div className="form-stack">
          {photoBackgroundWarmupStatus === "warming" && (
            <div className="blue-job-notice warming">
              <strong>蓝底引擎预热中</strong>
              <span>系统正在完成首次模型准备，预热完成后可立即提交蓝底作业。</span>
            </div>
          )}
          {photoBackgroundWarmupStatus === "failed" && (
            <div className="blue-job-notice failed">
              <strong>蓝底引擎预热失败</strong>
              <span>{photoBackgroundWarmupError || "请检查 N1 后端日志后重试。"}</span>
            </div>
          )}
          <select value={studentId} onChange={(event) => setStudentId(event.currentTarget.value ? Number(event.currentTarget.value) : "")}>
            <option value="">选择学生</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.bmp,.webp"
            onChange={(event) => {
              setPhoto(fileNameFromInput(event));
              setCrop(DEFAULT_PHOTO_CROP);
            }}
          />
          <div className="photo-preview-box">
            {previewUrl ? (
              <div className="photo-crop-frame">
                <img
                  src={previewUrl}
                  alt="待绑定照片预览"
                  style={{ objectPosition: cropObjectPosition, transform: `scale(${crop.zoom})` }}
                />
                <span>{DORM_PHOTO_WIDTH} x {DORM_PHOTO_HEIGHT}</span>
              </div>
            ) : (
              <span>选择照片后预览</span>
            )}
          </div>
          <div className="crop-controls">
            <label>
              <span>裁剪缩放</span>
              <input
                type="range"
                min={PHOTO_CROP_ZOOM_MIN}
                max={PHOTO_CROP_ZOOM_MAX}
                step={0.05}
                value={crop.zoom}
                disabled={!photo}
                onChange={(event) => {
                  const nextZoom = Number(event.currentTarget.value);
                  setCrop((current) => updatePhotoCropSetting(current, "zoom", nextZoom));
                }}
              />
            </label>
            <label>
              <span>左右</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={crop.offsetX}
                disabled={!photo}
                onChange={(event) => {
                  const nextOffsetX = Number(event.currentTarget.value);
                  setCrop((current) => updatePhotoCropSetting(current, "offsetX", nextOffsetX));
                }}
              />
            </label>
            <label>
              <span>上下</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={crop.offsetY}
                disabled={!photo}
                onChange={(event) => {
                  const nextOffsetY = Number(event.currentTarget.value);
                  setCrop((current) => updatePhotoCropSetting(current, "offsetY", nextOffsetY));
                }}
              />
            </label>
            <button className="text-button" type="button" disabled={!photo} onClick={() => setCrop(DEFAULT_PHOTO_CROP)}>
              重置裁剪
            </button>
            <button
              className="text-button"
              type="button"
              disabled={!photo || !studentId || photoBackgroundWarming || blueBackgroundMutation.isPending || Boolean(blueBackgroundJobId)}
              onClick={() => blueBackgroundMutation.mutate()}
            >
              <Image size={16} />
              {photoBackgroundWarming ? "蓝底引擎预热中" : blueBackgroundMutation.isPending ? "正在加入队列" : blueBackgroundJobId ? "蓝底作业进行中" : "设置蓝底"}
            </button>
          </div>
          {blueBackgroundJob && (
            <div className={`blue-job-notice ${blueBackgroundJob.status}`}>
              <strong>
                {blueBackgroundJob.status === "queued"
                  ? "蓝底作业已排队"
                  : blueBackgroundJob.status === "running"
                    ? "蓝底作业处理中"
                    : "蓝底作业状态更新中"}
              </strong>
              <span>
                {blueBackgroundJob.status === "queued" && blueBackgroundJob.queue_ahead_count
                  ? `前方还有 ${blueBackgroundJob.queue_ahead_count} 个作业。`
                  : "请耐心等待。"} 处理完成后会在最近活动中高亮提示。
              </span>
            </div>
          )}
          {selectedStudent && (
            <div className="selected-student-card">
              <strong>{formatPhotoSequenceNumber(selectedStudent.index)}号 · {selectedStudent.name}</strong>
              <span>{selectedStudent.hometown || "未填写籍贯"} · 送生区：{selectedStudent.source_area || "未填写"}</span>
              <span>{selectedStudent.photo_url ? "已有照片，绑定后会替换" : "尚未绑定照片"}</span>
            </div>
          )}
          <button
            className="primary-action"
            onClick={() => attachMutation.mutate()}
            disabled={!studentId || !photo || Boolean(blueBackgroundJobId) || attachMutation.isPending}
          >
            <Save size={18} />
            裁剪后绑定
          </button>
          <div className="photo-section-break" />
          <div className="mini-heading">
            <strong>批量匹配</strong>
            <span>{bulkResults.length}</span>
          </div>
          <label className="text-button wide">
            <Upload size={16} />
            选择多张照片
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.bmp,.webp"
              disabled={bulkImportMutation.isPending}
              onChange={(event) => {
                const files = filesFromInput(event);
                if (files.length) bulkImportMutation.mutate(files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <label className="text-button wide">
            <Upload size={16} />
            选择照片文件夹
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.bmp,.webp"
              disabled={bulkImportMutation.isPending}
              {...{ webkitdirectory: "" }}
              onChange={(event) => {
                const files = filesFromInput(event);
                if (files.length) bulkImportMutation.mutate(files);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>
      <div className="tool-panel">
        <div className="panel-heading">
          <h2>处理状态</h2>
        </div>
        <div className="metric-grid">
          <div>
            <strong>{boundCount}</strong>
            <span>已绑定</span>
          </div>
          <div>
            <strong>{rosterFilterCounts.missing}</strong>
            <span>缺照片</span>
          </div>
          <div>
            <strong>{rosterFilterCounts.all}</strong>
            <span>总人数</span>
          </div>
        </div>
        <div className="photo-export-actions">
          <button
            className="primary-action secondary"
            type="button"
            disabled={students.length === 0 || exportPhotoStatusReportMutation.isPending}
            onClick={() => exportPhotoStatusReportMutation.mutate()}
          >
            <FileSpreadsheet size={18} />
            下载状态清单
          </button>
          <button
            className="primary-action secondary"
            type="button"
            disabled={boundCount === 0 || exportPhotosZipMutation.isPending}
            onClick={() => exportPhotosZipMutation.mutate()}
          >
            <Download size={18} />
            下载照片包
          </button>
        </div>
        {bulkResults.length > 0 && (
          <div className="photo-import-results">
            <div className="mini-heading">
              <strong>最近批量导入</strong>
              <div className="mini-heading-actions">
                {suggestedBinds.length > 0 && (
                  <button
                    className="text-button compact"
                    type="button"
                    disabled={attachSuggestedPhotosMutation.isPending}
                    onClick={() => attachSuggestedPhotosMutation.mutate(suggestedBinds)}
                  >
                    绑定全部建议
                  </button>
                )}
                {bulkReport && (
                  <button className="text-button compact" type="button" onClick={() => openDownload(bulkReport)}>
                    下载清单
                  </button>
                )}
                <span>{bulkFilterCounts.matched}/{bulkFilterCounts.all}</span>
              </div>
            </div>
            {bulkMissingSequences.length > 0 && (
              <div className="photo-sequence-alert">
                <AlertTriangle size={16} />
                <div>
                  <strong>文件序号缺口</strong>
                  <span>缺 {bulkMissingSequenceText}</span>
                  {bulkSequenceGapStudents.length > 0 && (
                    <div className="photo-sequence-gap-students">
                      {bulkSequenceGapStudents.map((student) => (
                        <button
                          className={student.photo_bound ? "bound" : "missing"}
                          key={`${student.index}-${student.student_id}`}
                          type="button"
                          onClick={() => {
                            setStudentId(student.student_id);
                            setRosterFilter(photoRosterFilterForGapStudent(student));
                          }}
                        >
                          {photoSequenceGapStudentLabel(student)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {imageSpecSummary.length > 0 && (
              <div className="photo-spec-summary">
                <strong>图片规格</strong>
                <div>
                  {imageSpecSummary.slice(0, 6).map((item) => (
                    <span className={item.count === 1 ? "rare" : ""} key={`${item.size}-${item.format}`}>
                      {item.size} · {item.format}（{item.count}张）
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="segmented-control photo-import-filter">
              <button className={bulkFilter === "needs_review" ? "active" : ""} type="button" onClick={() => setBulkFilter("needs_review")}>
                需处理 {bulkFilterCounts.needs_review}
              </button>
              <button className={bulkFilter === "matched" ? "active" : ""} type="button" onClick={() => setBulkFilter("matched")}>
                已绑定 {bulkFilterCounts.matched}
              </button>
              <button className={bulkFilter === "all" ? "active" : ""} type="button" onClick={() => setBulkFilter("all")}>
                全部 {bulkFilterCounts.all}
              </button>
            </div>
            <div className="photo-import-list">
              {visibleBulkResults.length === 0 && <div className="photo-import-empty">当前筛选没有照片</div>}
              {visibleBulkResults.map((item, index) => {
                const canBindImportedPhoto = photoImportCanBind(item);
                const canBindSuggestedStudent = canBindImportedPhoto && Boolean(item.suggested_student_id);
                const imageInfo = photoImageSpecLabel(item);
                return (
                  <div
                    className={canBindImportedPhoto ? "photo-import-row needs-review" : "photo-import-row"}
                    key={item.file_id ?? `${item.filename}-${index}`}
                  >
                    <span className={`photo-import-status ${item.status}`}>{photoImportStatusLabel(item.status)}</span>
                    {item.download_url ? (
                      <a className="photo-import-thumb" href={item.download_url} target="_blank" rel="noreferrer" title="打开原图">
                        <img src={item.download_url} alt={`${item.filename}预览`} loading="lazy" />
                      </a>
                    ) : (
                      <div className="photo-import-thumb">
                        <Camera size={18} />
                      </div>
                    )}
                    <div>
                      <strong>{item.student_name || item.filename}</strong>
                      <small>{item.student_name ? item.filename : item.message}</small>
                      {imageInfo && <small className="photo-import-meta">原图：{imageInfo}</small>}
                      {item.suggested_student_name && (
                        <small className="photo-import-suggestion">
                          建议：{formatPhotoSequenceNumber(item.suggested_student_index ?? item.sequence_number ?? 0)}号 {item.suggested_student_name}
                        </small>
                      )}
                    </div>
                    {canBindImportedPhoto && (
                      <div className="photo-import-actions">
                        {canBindSuggestedStudent && (
                          <button
                            className="text-button compact"
                            type="button"
                            disabled={attachImportedPhotoMutation.isPending || attachSuggestedPhotosMutation.isPending}
                            onClick={() => {
                              if (!item.file_id || !item.suggested_student_id) return;
                              attachImportedPhotoMutation.mutate({ fileId: item.file_id, targetStudentId: item.suggested_student_id });
                            }}
                          >
                            绑定建议
                          </button>
                        )}
                        <button
                          className="text-button compact"
                          type="button"
                          disabled={!studentId || attachImportedPhotoMutation.isPending || attachSuggestedPhotosMutation.isPending}
                          onClick={() => {
                            if (!studentId || !item.file_id) return;
                            attachImportedPhotoMutation.mutate({ fileId: item.file_id, targetStudentId: Number(studentId) });
                          }}
                        >
                          绑定选中
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="photo-roster-tools">
          <div className="mini-heading">
            <strong>学生照片检查</strong>
            <span>{rosterFilterCounts.bound}/{rosterFilterCounts.all}</span>
          </div>
          <div className="segmented-control photo-roster-filter">
            <button className={rosterFilter === "missing" ? "active" : ""} type="button" onClick={() => setRosterFilter("missing")}>
              缺照片 {rosterFilterCounts.missing}
            </button>
            <button className={rosterFilter === "bound" ? "active" : ""} type="button" onClick={() => setRosterFilter("bound")}>
              已绑定 {rosterFilterCounts.bound}
            </button>
            <button className={rosterFilter === "all" ? "active" : ""} type="button" onClick={() => setRosterFilter("all")}>
              全部 {rosterFilterCounts.all}
            </button>
          </div>
        </div>
        <div className="photo-roster">
          {visibleRosterStudents.length === 0 && <div className="photo-roster-empty">当前筛选没有学生</div>}
          {visibleRosterStudents.map((student) => (
            <div
              key={student.id}
              className={student.id === studentId ? "photo-roster-card active" : "photo-roster-card"}
              role="button"
              tabIndex={0}
              onClick={() => setStudentId(student.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setStudentId(student.id);
                }
              }}
            >
              <div className="photo-thumb">
                <span className="photo-index-badge">{formatPhotoSequenceNumber(student.index)}</span>
                {student.photo_url ? <img src={student.photo_url} alt={`${student.name}照片`} /> : <Camera size={18} />}
              </div>
              <span>{student.name}</span>
              <small>{student.photo_url ? "已绑定" : student.photo_match_status}</small>
              {student.photo_url && (
                <button
                  className="photo-clear-button"
                  type="button"
                  disabled={clearPhotoMutation.isPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    clearPhotoMutation.mutate(student.id);
                  }}
                >
                  <Trash2 size={13} />
                  清除
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Workspace({ user, logout, changePassword }: { user: User; logout: () => void; changePassword: () => void }) {
  const [showAccounts, setShowAccounts] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("students");
  const [status, setStatus] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [newClassName, setNewClassName] = useState("");
  const [defaultProjectRequested, setDefaultProjectRequested] = useState(false);
  const [resumePhotoJobId, setResumePhotoJobId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const activitiesQuery = useQuery({
    queryKey: ["activities", selectedProjectId],
    queryFn: () => api.activities(selectedProjectId ?? 0),
    enabled: selectedProjectId !== null,
    refetchInterval: 5000
  });
  const createProjectMutation = useMutation({
    mutationFn: (name: string) => api.createProject(name),
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(["projects"], (current = []) => [
        project,
        ...current.filter((item) => item.id !== project.id)
      ]);
      setSelectedProjectId(project.id);
      setNewClassName("");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setStatus(`已新建班级 ${project.name}`);
    },
    onError: (error) => setStatus(error.message)
  });

  useEffect(() => {
    if (projectsQuery.data && projectsQuery.data.length === 0 && !createProjectMutation.isPending && !defaultProjectRequested) {
      setDefaultProjectRequested(true);
      createProjectMutation.mutate("默认班级项目");
    }
  }, [projectsQuery.data, createProjectMutation.isPending, defaultProjectRequested]);

  useEffect(() => {
    const projects = projectsQuery.data ?? [];
    if (!projects.length) return;
    if (selectedProjectId === null) {
      setSelectedProjectId(projects[0].id);
      return;
    }
    if (projects.some((project) => project.id === selectedProjectId)) return;
    if (projectsQuery.isFetching) return;
    setSelectedProjectId(projects[0].id);
  }, [projectsQuery.data, projectsQuery.isFetching, selectedProjectId]);

  const projects = projectsQuery.data ?? [];
  const project = useMemo(() => projects.find((item) => item.id === selectedProjectId) ?? null, [projects, selectedProjectId]);

  function reportStatus(value: string) {
    setStatus(value);
    if (selectedProjectId !== null) {
      queryClient.invalidateQueries({ queryKey: ["activities", selectedProjectId] });
    }
  }

  function selectProject(projectId: number) {
    const nextProject = projects.find((item) => item.id === projectId);
    setSelectedProjectId(projectId);
    if (nextProject) setStatus(`已切换到 ${nextProject.name}`);
  }

  function createClass() {
    const name = newClassName.trim();
    if (name) createProjectMutation.mutate(name);
  }

  function resumeBlueBackgroundJob(jobId: string) {
    setActiveTab("photos");
    setResumePhotoJobId(jobId);
    setStatus("正在打开已完成的蓝底照片，可继续裁剪绑定");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <h1>QX班小助</h1>
          <p>{project ? `当前班级：${project.name}` : "连接后端中"}</p>
          <ClassSelector
            projects={projects}
            selectedProjectId={project?.id ?? null}
            newClassName={newClassName}
            isCreating={createProjectMutation.isPending}
            onSelect={selectProject}
            onNameChange={setNewClassName}
            onCreate={createClass}
          />
        </div>
        <nav className="tabs" aria-label="主导航">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => { setShowAccounts(false); setActiveTab(tab.key); }}>
                <Icon size={17} />
                {tab.label}
              </button>
            );
          })}
          {user.role === "admin" && <button className={showAccounts ? "active" : ""} onClick={() => setShowAccounts(true)}>账号管理</button>}
          <span className="account-identity">{user.display_name || user.username} · {user.role === "admin" ? "管理员" : "普通用户"}</span>
          <button onClick={changePassword}>修改密码</button>
          <button onClick={logout}>退出登录</button>
        </nav>
      </header>
      <StatusLine text={status} />
      {!showAccounts && project && (
        <ActivityPanel
          activities={activitiesQuery.data ?? []}
          isLoading={activitiesQuery.isLoading}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: ["activities", project.id] })}
          onResumeBlueBackgroundJob={resumeBlueBackgroundJob}
        />
      )}
      {showAccounts && user.role === "admin" ? <AccountsPage /> : project ? (
        <>
          {activeTab === "students" && <StudentsPage projectId={project.id} className={project.name} onStatus={reportStatus} />}
          {activeTab === "seats" && <SeatsPage projectId={project.id} onStatus={reportStatus} />}
          {activeTab === "dorms" && <DormsPage projectId={project.id} onStatus={reportStatus} />}
          {activeTab === "stickers" && <StickersPage projectId={project.id} onStatus={reportStatus} />}
          {activeTab === "photos" && (
            <PhotosPage
              projectId={project.id}
              onStatus={reportStatus}
              resumeBlueBackgroundJobId={resumePhotoJobId}
              onResumeBlueBackgroundJobHandled={() => setResumePhotoJobId(null)}
            />
          )}
        </>
      ) : (
        <div className="empty-panel">正在准备项目</div>
      )}
    </main>
  );
}

export default function App() {
  return <AuthGate>{(actions) => <Workspace key={actions.user.id} {...actions} />}</AuthGate>;
}
