import type { Activity, DormRoom, FileResult, HealthStatus, PhotoBackgroundJob, PhotoImportSummary, Project, RecentDormRoster, SeatLayout, Student } from "./types";

const API_PREFIX = "/api/v1";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...init
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    if (response.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("qxban-auth-expired"));
    const detail = body.detail;
    const message = typeof detail === "string" ? detail : detail?.errors ? `${detail.message}：${detail.errors.map((item: { row: number; message: string }) => `第 ${item.row} 行 ${item.message}`).join("；")}` : Array.isArray(detail) ? "请检查输入内容" : response.statusText;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthStatus>("/health"),
  projects: () => request<Project[]>("/projects"),
  activities: (projectId: number, limit = 8) => request<Activity[]>(`/projects/${projectId}/activities?limit=${limit}`),
  studentInfoTemplateUrl: () => `${API_PREFIX}/templates/student-info/download`,
  createProject: (name: string) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  updateProject: (projectId: number, name: string) =>
    request<Project>(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    }),
  students: (projectId: number) => request<Student[]>(`/projects/${projectId}/students`),
  createStudent: (projectId: number, student: Pick<Student, "name" | "hometown" | "class_name" | "source_area">) =>
    request<Student>(`/projects/${projectId}/students`, {
      method: "POST",
      body: JSON.stringify(student)
    }),
  importStudents: (projectId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ imported_count: number; students: Student[] }>(`/projects/${projectId}/students/import-excel`, {
      method: "POST",
      body: form
    });
  },
  patchStudent: (projectId: number, studentId: number, patch: Partial<Pick<Student, "name" | "hometown" | "class_name" | "source_area">>) =>
    request<Student>(`/projects/${projectId}/students/${studentId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  deleteStudent: (projectId: number, studentId: number) =>
    request<{ deleted: boolean }>(`/projects/${projectId}/students/${studentId}`, { method: "DELETE" }),
  exportStudents: (projectId: number) =>
    request<FileResult>(`/projects/${projectId}/students/export-excel`, { method: "POST" }),
  uploadPhoto: (projectId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<FileResult>(`/projects/${projectId}/photos/upload`, { method: "POST", body: form });
  },
  setPhotoBlueBackground: (projectId: number, studentId: number, file: File) => {
    const form = new FormData();
    form.append("student_id", String(studentId));
    form.append("file", file);
    return request<PhotoBackgroundJob>(`/projects/${projectId}/photos/blue-background`, { method: "POST", body: form });
  },
  photoBlueBackgroundJob: (projectId: number, jobId: string) =>
    request<PhotoBackgroundJob>(`/projects/${projectId}/photos/blue-background/jobs/${jobId}`),
  importPhotos: (projectId: number, files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    return request<PhotoImportSummary>(`/projects/${projectId}/photos/import`, { method: "POST", body: form });
  },
  attachPhoto: (projectId: number, studentId: number, fileId: string) =>
    request<Student>(`/projects/${projectId}/students/${studentId}/photo`, {
      method: "POST",
      body: JSON.stringify({ file_id: fileId })
    }),
  clearPhoto: (projectId: number, studentId: number) =>
    request<Student>(`/projects/${projectId}/students/${studentId}/photo`, { method: "DELETE" }),
  exportPhotoStatusReport: (projectId: number) =>
    request<FileResult>(`/projects/${projectId}/photos/status-report`, { method: "POST" }),
  exportPhotosZip: (projectId: number) => request<FileResult>(`/projects/${projectId}/photos/export-zip`, { method: "POST" }),
  seats: (projectId: number) => request<{ layout: SeatLayout }>(`/projects/${projectId}/seats`),
  saveSeats: (projectId: number, layout: SeatLayout) =>
    request<{ layout: SeatLayout }>(`/projects/${projectId}/seats`, {
      method: "PUT",
      body: JSON.stringify({ layout })
    }),
  resetSeats: (projectId: number) => request<{ layout: SeatLayout }>(`/projects/${projectId}/seats/reset`, { method: "POST" }),
  exportSeats: (projectId: number) => request<FileResult>(`/projects/${projectId}/seats/export-pdf`, { method: "POST" }),
  dorms: (projectId: number) => request<{ rooms: DormRoom[] }>(`/projects/${projectId}/dorms`),
  recentDormRosters: (projectId: number) => request<RecentDormRoster[]>(`/projects/${projectId}/dorms/recent`),
  restoreRecentDormRoster: (projectId: number, fileId: string) =>
    request<{ room_count: number; matched_count: number; rooms: DormRoom[] }>(`/projects/${projectId}/dorms/recent/${fileId}/restore`, {
      method: "POST"
    }),
  saveDorms: (projectId: number, rooms: DormRoom[]) =>
    request<{ rooms: DormRoom[] }>(`/projects/${projectId}/dorms`, {
      method: "PUT",
      body: JSON.stringify({ rooms })
    }),
  importDorms: (projectId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ room_count: number; matched_count: number; rooms: DormRoom[] }>(`/projects/${projectId}/dorms/import-excel`, {
      method: "POST",
      body: form
    });
  },
  exportDorms: (projectId: number, title: string) =>
    request<FileResult>(`/projects/${projectId}/dorms/export-excel`, {
      method: "POST",
      body: JSON.stringify({ title })
    }),
  exportStickers: (projectId: number, stickerKind: "door" | "bed_cabinet", studentIds: number[]) =>
    request<FileResult>(`/projects/${projectId}/stickers/export-pdf`, {
      method: "POST",
      body: JSON.stringify({ sticker_kind: stickerKind, student_ids: studentIds })
    })
};

export function openDownload(file: FileResult): void {
  window.open(file.download_url, "_blank", "noopener,noreferrer");
}
