import type { Activity } from "./types";

export function isHighlightedActivity(activity: Activity): boolean {
  return activity.kind === "photo_blue_background" && activity.detail.highlight === true;
}

export function resumablePhotoBackgroundJobId(activity: Activity): string | null {
  const jobId = activity.detail.job_id;
  return isHighlightedActivity(activity) && typeof jobId === "string" && jobId ? jobId : null;
}
