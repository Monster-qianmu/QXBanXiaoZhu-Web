import { describe, expect, it } from "vitest";

import { isHighlightedActivity, resumablePhotoBackgroundJobId } from "./activities";
import type { Activity } from "./types";

function activity(detail: Record<string, unknown>, kind = "photo_blue_background"): Activity {
  return {
    id: "activity-1",
    kind,
    message: "张三同学蓝底设置成功",
    level: "success",
    detail,
    created_at: "2026-07-13T02:00:00"
  };
}

describe("recent activity highlights", () => {
  it("highlights completed blue-background activities only", () => {
    expect(isHighlightedActivity(activity({ highlight: true }))).toBe(true);
    expect(isHighlightedActivity(activity({}))).toBe(false);
    expect(isHighlightedActivity(activity({ highlight: true }, "photos"))).toBe(false);
  });

  it("exposes a completed blue-background job for resuming in the photo workspace", () => {
    expect(resumablePhotoBackgroundJobId(activity({ highlight: true, job_id: "job-1" }))).toBe("job-1");
    expect(resumablePhotoBackgroundJobId(activity({ highlight: true }))).toBeNull();
    expect(resumablePhotoBackgroundJobId(activity({ job_id: "job-1" }))).toBeNull();
  });
});
