export type Project = {
  id: number;
  name: string;
  created_at: string;
};

export type Activity = {
  id: string;
  project_id?: number | null;
  kind: string;
  message: string;
  level: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export type Student = {
  id: number;
  index: number;
  name: string;
  hometown: string;
  source_area: string;
  class_name: string;
  photo_match_status: string;
  photo_url?: string | null;
};

export type Seat = {
  name: string;
  x: number;
  y: number;
};

export type SeatLayout = {
  version: number;
  source_excel_path: string;
  student_names: string[];
  rows: number;
  columns: number;
  left: number;
  top: number;
  scale_percent?: number;
  row_label_position: "left" | "right" | "none";
  title_text: string;
  seats: Seat[];
};

export type DormRoom = {
  number: string;
  beds: Array<string | null>;
};

export type FileResult = {
  file_id: string;
  filename: string;
  download_url: string;
};

export type PhotoBackgroundJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  queue_ahead_count: number;
  student_id: number;
  student_name: string;
  filename: string;
  result?: FileResult | null;
  error_message: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};

export type HealthStatus = {
  ok: boolean;
  data_dir: string;
  photo_task_concurrency: number;
  photo_background_enabled: boolean;
  photo_background_configured: boolean;
  photo_background_warmup_status: "disabled" | "warming" | "ready" | "failed";
  photo_background_warmup_error: string;
};

export type RecentDormRoster = FileResult & {
  created_at: string;
};

export type PhotoImportResult = {
  filename: string;
  status: string;
  message: string;
  image_width?: number | null;
  image_height?: number | null;
  image_format?: string | null;
  student_id?: number | null;
  student_name?: string | null;
  sequence_number?: number | null;
  suggested_student_id?: number | null;
  suggested_student_name?: string | null;
  suggested_student_index?: number | null;
  file_id?: string | null;
  download_url?: string | null;
};

export type PhotoSequenceGapStudent = {
  index: number;
  student_id: number;
  name: string;
  photo_bound: boolean;
  photo_match_status: string;
};

export type PhotoImportSummary = {
  matched_count: number;
  unmatched_count: number;
  sequence_numbers?: number[];
  missing_sequence_numbers?: number[];
  sequence_gap_students?: PhotoSequenceGapStudent[];
  report_file_id?: string | null;
  report_filename?: string | null;
  report_download_url?: string | null;
  results: PhotoImportResult[];
};

export type TabKey = "students" | "seats" | "dorms" | "stickers" | "photos";

export type User = {
  id: number;
  username: string;
  phone: string | null;
  display_name: string;
  role: "admin" | "user";
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
};
