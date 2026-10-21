import { describe, expect, it } from "vitest";
import {
  clampPhotoCropSettings,
  clearPhotoImportBindingForStudent,
  DORM_PHOTO_HEIGHT,
  DORM_PHOTO_WIDTH,
  filterPhotoImportResults,
  filterPhotoRosterStudents,
  photoImageSpecLabel,
  photoImageSpecSummary,
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
import type { PhotoImportResult, Student } from "./types";

describe("photo crop helpers", () => {
  it("uses the dorm sticker photo aspect ratio", () => {
    const rect = photoCropSourceRect(400, 300, { zoom: 1, offsetX: 0, offsetY: 0 });

    expect(rect.width / rect.height).toBeCloseTo(DORM_PHOTO_WIDTH / DORM_PHOTO_HEIGHT);
    expect(rect.x).toBeGreaterThan(0);
    expect(rect.y).toBe(0);
  });

  it("crops vertical photos from the center without exceeding the image", () => {
    const rect = photoCropSourceRect(300, 600, { zoom: 1, offsetX: 0, offsetY: 0 });

    expect(rect.x).toBe(0);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(600);
  });

  it("applies zoom and offset inside the allowed source bounds", () => {
    const rect = photoCropSourceRect(400, 300, { zoom: 2, offsetX: 100, offsetY: -100 });

    expect(rect.width).toBeLessThan(400);
    expect(rect.height).toBeLessThan(300);
    expect(rect.x + rect.width).toBeCloseTo(400);
    expect(rect.y).toBe(0);
  });

  it("clamps crop controls", () => {
    expect(clampPhotoCropSettings({ zoom: 8, offsetX: -180, offsetY: 150 })).toEqual({
      zoom: 3,
      offsetX: -100,
      offsetY: 100
    });
  });

  it("updates a single crop control from a captured numeric value", () => {
    const current = { zoom: 1.2, offsetX: -10, offsetY: 20 };

    expect(updatePhotoCropSetting(current, "zoom", 2.5)).toEqual({ zoom: 2.5, offsetX: -10, offsetY: 20 });
    expect(updatePhotoCropSetting(current, "offsetX", 160)).toEqual({ zoom: 1.2, offsetX: 100, offsetY: 20 });
    expect(updatePhotoCropSetting(current, "offsetY", Number.NaN)).toEqual({ zoom: 1.2, offsetX: -10, offsetY: 0 });
  });
});

describe("photo import result helpers", () => {
  const results: PhotoImportResult[] = [
    {
      filename: "01_张三.jpg",
      status: "strict",
      message: "文件名清理序号后与学生姓名一致",
      student_id: 1,
      student_name: "张三",
      image_width: 295,
      image_height: 413,
      image_format: "JPEG",
      file_id: "file-1",
      download_url: "/api/v1/files/file-1/download"
    },
    {
      filename: "06_.jpg",
      status: "unmatched",
      message: "文件名缺少学生姓名",
      suggested_student_id: 6,
      suggested_student_name: "赵六",
      suggested_student_index: 6,
      image_width: 1024,
      image_height: 1368,
      image_format: "JPEG",
      file_id: "file-2",
      download_url: "/api/v1/files/file-2/download"
    },
    {
      filename: "notes.txt",
      status: "rejected",
      message: "不支持的文件类型",
      suggested_student_id: 7,
      suggested_student_name: "损坏图片同学",
      image_width: null,
      image_height: null,
      image_format: null,
      file_id: "file-rejected",
      download_url: "/api/v1/files/file-rejected/download"
    },
    {
      filename: "手动绑定.png",
      status: "manual",
      message: "已手动绑定",
      student_id: 2,
      student_name: "李四",
      image_width: 295,
      image_height: 413,
      image_format: "JPEG",
      file_id: "file-3",
      download_url: "/api/v1/files/file-3/download"
    }
  ];

  it("counts import results by teacher workflow state", () => {
    expect(photoImportFilterCounts(results)).toEqual({
      all: 4,
      needs_review: 1,
      matched: 2
    });
  });

  it("filters to photos that still need teacher review", () => {
    expect(filterPhotoImportResults(results, "needs_review").map((item) => item.filename)).toEqual(["06_.jpg"]);
    expect(photoImportNeedsReview(results[1])).toBe(true);
    expect(photoImportNeedsReview(results[2])).toBe(false);
    expect(photoImportCanBind(results[1])).toBe(true);
    expect(photoImportCanBind(results[2])).toBe(false);
  });

  it("filters to automatically or manually bound photos", () => {
    expect(filterPhotoImportResults(results, "matched").map((item) => item.filename)).toEqual(["01_张三.jpg", "手动绑定.png"]);
  });

  it("collects unbound photos that can be bound by sequence suggestion", () => {
    expect(photoImportSuggestedBinds(results)).toEqual([
      {
        fileId: "file-2",
        targetStudentId: 6,
        filename: "06_.jpg",
        studentName: "赵六"
      }
    ]);
  });

  it("summarizes imported photo image specs", () => {
    expect(photoImageSpecLabel(results[0])).toBe("295 x 413 · JPEG");
    expect(photoImageSpecLabel(results[2])).toBe("无法读取 · 未知");
    expect(photoImageSpecSummary(results)).toEqual([
      {
        size: "295 x 413",
        format: "JPEG",
        count: 2,
        examples: ["01_张三.jpg", "手动绑定.png"]
      },
      {
        size: "1024 x 1368",
        format: "JPEG",
        count: 1,
        examples: ["06_.jpg"]
      },
      {
        size: "无法读取",
        format: "未知",
        count: 1,
        examples: ["notes.txt"]
      }
    ]);
  });

  it("returns a cleared import binding to the review queue", () => {
    const cleared = clearPhotoImportBindingForStudent(results, 1);
    expect(cleared[0]).toMatchObject({
      filename: "01_张三.jpg",
      status: "unmatched",
      message: "已清除绑定，可重新处理",
      student_id: null,
      student_name: null,
      suggested_student_id: 1,
      suggested_student_name: "张三",
      file_id: "file-1"
    });
    expect(photoImportSuggestedBinds(cleared)).toEqual([
      {
        fileId: "file-1",
        targetStudentId: 1,
        filename: "01_张三.jpg",
        studentName: "张三"
      },
      {
        fileId: "file-2",
        targetStudentId: 6,
        filename: "06_.jpg",
        studentName: "赵六"
      }
    ]);
    expect(photoImportFilterCounts(cleared)).toEqual({
      all: 4,
      needs_review: 2,
      matched: 1
    });
  });

  it("formats file sequence gap students with photo coverage state", () => {
    expect(
      photoSequenceGapStudentLabel({
        index: 2,
        student_id: 2,
        name: "李四",
        photo_bound: true,
        photo_match_status: "fuzzy"
      })
    ).toBe("02号 李四（已绑定）");
    expect(
      photoSequenceGapStudentLabel({
        index: 18,
        student_id: 18,
        name: "王五",
        photo_bound: false,
        photo_match_status: "unmatched"
      })
    ).toBe("18号 王五（缺照片）");
  });

  it("chooses the roster filter for a sequence gap student", () => {
    expect(
      photoRosterFilterForGapStudent({
        index: 2,
        student_id: 2,
        name: "李四",
        photo_bound: true,
        photo_match_status: "strict"
      })
    ).toBe("bound");
    expect(
      photoRosterFilterForGapStudent({
        index: 18,
        student_id: 18,
        name: "王五",
        photo_bound: false,
        photo_match_status: "unmatched"
      })
    ).toBe("missing");
  });
});

describe("photo roster coverage helpers", () => {
  const students: Student[] = [
    {
      id: 1,
      index: 1,
      name: "张三",
      hometown: "广州",
      class_name: "一班",
      source_area: "",
      photo_match_status: "strict",
      photo_url: "/api/v1/files/file-1/download"
    },
    {
      id: 2,
      index: 2,
      name: "李四",
      hometown: "深圳",
      class_name: "一班",
      source_area: "",
      photo_match_status: "missing"
    },
    {
      id: 3,
      index: 3,
      name: "王五",
      hometown: "佛山",
      class_name: "一班",
      source_area: "",
      photo_match_status: "manual",
      photo_url: "/api/v1/files/file-3/download"
    }
  ];

  it("counts students by photo coverage state", () => {
    expect(photoRosterFilterCounts(students)).toEqual({
      all: 3,
      missing: 1,
      bound: 2
    });
  });

  it("filters missing and bound student photos", () => {
    expect(filterPhotoRosterStudents(students, "missing").map((student) => student.name)).toEqual(["李四"]);
    expect(filterPhotoRosterStudents(students, "bound").map((student) => student.name)).toEqual(["张三", "王五"]);
    expect(filterPhotoRosterStudents(students, "all")).toHaveLength(3);
  });
});
