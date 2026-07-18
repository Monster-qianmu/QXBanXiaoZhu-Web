import type { PhotoImportResult, PhotoSequenceGapStudent, Student } from "./types";

export const DORM_PHOTO_WIDTH = 160;
export const DORM_PHOTO_HEIGHT = 210;
export const PHOTO_BACKGROUND_COLOR = "#00acfd";
export const PHOTO_CROP_ZOOM_MIN = 1;
export const PHOTO_CROP_ZOOM_MAX = 3;

export type PhotoCropSettings = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type PhotoCropSettingKey = keyof PhotoCropSettings;

export type CropSourceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PhotoImportFilter = "all" | "needs_review" | "matched";
export type PhotoRosterFilter = "all" | "missing" | "bound";

export type PhotoImportFilterCounts = {
  all: number;
  needs_review: number;
  matched: number;
};

export type PhotoRosterFilterCounts = {
  all: number;
  missing: number;
  bound: number;
};

export type PhotoSuggestedBind = {
  fileId: string;
  targetStudentId: number;
  filename: string;
  studentName: string;
};

export type PhotoImageSpecSummaryItem = {
  size: string;
  format: string;
  count: number;
  examples: string[];
};

export const DEFAULT_PHOTO_CROP: PhotoCropSettings = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampPhotoCropSettings(settings: PhotoCropSettings): PhotoCropSettings {
  return {
    zoom: clamp(Number.isFinite(settings.zoom) ? settings.zoom : 1, PHOTO_CROP_ZOOM_MIN, PHOTO_CROP_ZOOM_MAX),
    offsetX: clamp(Number.isFinite(settings.offsetX) ? settings.offsetX : 0, -100, 100),
    offsetY: clamp(Number.isFinite(settings.offsetY) ? settings.offsetY : 0, -100, 100)
  };
}

export function updatePhotoCropSetting(settings: PhotoCropSettings, key: PhotoCropSettingKey, value: number): PhotoCropSettings {
  return clampPhotoCropSettings({ ...settings, [key]: value });
}

export function photoCropSourceRect(
  imageWidth: number,
  imageHeight: number,
  settings: PhotoCropSettings,
  targetWidth = DORM_PHOTO_WIDTH,
  targetHeight = DORM_PHOTO_HEIGHT
): CropSourceRect {
  if (imageWidth <= 0 || imageHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const crop = clampPhotoCropSettings(settings);
  const imageAspect = imageWidth / imageHeight;
  const targetAspect = targetWidth / targetHeight;
  const baseWidth = imageAspect > targetAspect ? imageHeight * targetAspect : imageWidth;
  const baseHeight = imageAspect > targetAspect ? imageHeight : imageWidth / targetAspect;
  const width = Math.min(imageWidth, baseWidth / crop.zoom);
  const height = Math.min(imageHeight, baseHeight / crop.zoom);
  const maxX = Math.max(0, imageWidth - width);
  const maxY = Math.max(0, imageHeight - height);
  const x = clamp(maxX / 2 + (crop.offsetX / 100) * (maxX / 2), 0, maxX);
  const y = clamp(maxY / 2 + (crop.offsetY / 100) * (maxY / 2), 0, maxY);
  return { x, y, width, height };
}

export function photoImportNeedsReview(item: PhotoImportResult): boolean {
  return photoImportCanBind(item);
}

export function photoImportCanBind(item: PhotoImportResult): boolean {
  return Boolean(item.file_id && !item.student_id && item.status !== "rejected");
}

export function photoImportIsMatched(item: PhotoImportResult): boolean {
  return Boolean(item.student_id);
}

export function photoImportFilterCounts(results: PhotoImportResult[]): PhotoImportFilterCounts {
  return results.reduce(
    (counts, item) => ({
      all: counts.all + 1,
      needs_review: counts.needs_review + (photoImportNeedsReview(item) ? 1 : 0),
      matched: counts.matched + (photoImportIsMatched(item) ? 1 : 0)
    }),
    { all: 0, needs_review: 0, matched: 0 }
  );
}

export function filterPhotoImportResults(results: PhotoImportResult[], filter: PhotoImportFilter): PhotoImportResult[] {
  if (filter === "needs_review") return results.filter(photoImportNeedsReview);
  if (filter === "matched") return results.filter(photoImportIsMatched);
  return results;
}

export function photoImportSuggestedBinds(results: PhotoImportResult[]): PhotoSuggestedBind[] {
  return results.flatMap((item) => {
    if (!photoImportCanBind(item) || !item.file_id || !item.suggested_student_id) return [];
    return [
      {
        fileId: item.file_id,
        targetStudentId: item.suggested_student_id,
        filename: item.filename,
        studentName: item.suggested_student_name || ""
      }
    ];
  });
}

export function clearPhotoImportBindingForStudent(results: PhotoImportResult[], studentId: number): PhotoImportResult[] {
  return results.map((item) => {
    if (item.student_id !== studentId) return item;
    const previousStudentId = item.student_id;
    const previousStudentName = item.student_name;
    return {
      ...item,
      status: "unmatched",
      message: "已清除绑定，可重新处理",
      suggested_student_id: previousStudentId,
      suggested_student_name: previousStudentName,
      student_id: null,
      student_name: null
    };
  });
}

export function photoImageSpecLabel(item: PhotoImportResult): string {
  const size = item.image_width && item.image_height ? `${item.image_width} x ${item.image_height}` : "无法读取";
  const format = item.image_format || "未知";
  return `${size} · ${format}`;
}

export function photoImageSpecSummary(results: PhotoImportResult[]): PhotoImageSpecSummaryItem[] {
  const grouped = new Map<string, PhotoImageSpecSummaryItem>();
  for (const item of results) {
    const [size, format] = photoImageSpecLabel(item).split(" · ");
    const key = `${size}|${format}`;
    const existing = grouped.get(key) ?? { size, format, count: 0, examples: [] };
    existing.count += 1;
    if (existing.examples.length < 3) existing.examples.push(item.filename);
    grouped.set(key, existing);
  }
  return Array.from(grouped.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    const sizeCompare = left.size.localeCompare(right.size, "zh-CN");
    if (sizeCompare !== 0) return sizeCompare;
    return left.format.localeCompare(right.format, "zh-CN");
  });
}

export function photoSequenceGapStudentLabel(student: PhotoSequenceGapStudent): string {
  const state = student.photo_bound ? "已绑定" : "缺照片";
  return `${String(student.index).padStart(2, "0")}号 ${student.name}（${state}）`;
}

export function photoRosterFilterForGapStudent(student: PhotoSequenceGapStudent): PhotoRosterFilter {
  return student.photo_bound ? "bound" : "missing";
}

export function studentPhotoMissing(student: Student): boolean {
  return !student.photo_url;
}

export function studentPhotoBound(student: Student): boolean {
  return Boolean(student.photo_url);
}

export function photoRosterFilterCounts(students: Student[]): PhotoRosterFilterCounts {
  return students.reduce(
    (counts, student) => ({
      all: counts.all + 1,
      missing: counts.missing + (studentPhotoMissing(student) ? 1 : 0),
      bound: counts.bound + (studentPhotoBound(student) ? 1 : 0)
    }),
    { all: 0, missing: 0, bound: 0 }
  );
}

export function filterPhotoRosterStudents(students: Student[], filter: PhotoRosterFilter): Student[] {
  if (filter === "missing") return students.filter(studentPhotoMissing);
  if (filter === "bound") return students.filter(studentPhotoBound);
  return students;
}
