import type { DormRoom } from "./types";

export type DormBedPosition = {
  roomIndex: number;
  bedIndex: number;
};

export type DormDragPayload =
  | { kind: "student"; studentId: string }
  | { kind: "bed"; roomIndex: number; bedIndex: number; studentId: string | null };

export function assignedStudentIdsForRooms(rooms: DormRoom[]): Set<string> {
  const ids = new Set<string>();
  for (const room of rooms) {
    for (const bed of room.beds) {
      if (bed) ids.add(String(bed));
    }
  }
  return ids;
}

export function isStudentAssignedElsewhere(assignedStudentIds: Set<string>, currentBed: string | null, studentId: string): boolean {
  return assignedStudentIds.has(studentId) && studentId !== String(currentBed ?? "");
}

export function dormStudentOptionLabel(name: string, hometown: string, isAssignedElsewhere: boolean): string {
  const baseLabel = `${name} ${hometown}`.trim();
  return isAssignedElsewhere ? `${baseLabel}（已安排）` : baseLabel;
}

export function cloneDormRooms(rooms: DormRoom[]): DormRoom[] {
  return rooms.map((room) => ({ ...room, beds: room.beds.slice() }));
}

export function assignStudentToBed(rooms: DormRoom[], studentId: string, target: DormBedPosition): DormRoom[] {
  const next = cloneDormRooms(rooms);
  const targetRoom = next[target.roomIndex];
  if (!targetRoom || target.bedIndex < 0) return rooms;
  while (targetRoom.beds.length <= target.bedIndex) targetRoom.beds.push(null);
  for (const room of next) {
    room.beds = room.beds.map((bed) => (bed === studentId ? null : bed));
  }
  targetRoom.beds[target.bedIndex] = studentId;
  return next;
}

export function moveBedStudent(rooms: DormRoom[], source: DormBedPosition, target: DormBedPosition): DormRoom[] {
  if (source.roomIndex === target.roomIndex && source.bedIndex === target.bedIndex) return rooms;
  const next = cloneDormRooms(rooms);
  const sourceRoom = next[source.roomIndex];
  const targetRoom = next[target.roomIndex];
  if (!sourceRoom || !targetRoom || source.bedIndex < 0 || target.bedIndex < 0) return rooms;
  while (targetRoom.beds.length <= target.bedIndex) targetRoom.beds.push(null);
  const sourceStudent = sourceRoom.beds[source.bedIndex] ?? null;
  const targetStudent = targetRoom.beds[target.bedIndex] ?? null;
  sourceRoom.beds[source.bedIndex] = targetStudent;
  targetRoom.beds[target.bedIndex] = sourceStudent;
  return next;
}

export function reorderBedWithinRoom(rooms: DormRoom[], roomIndex: number, fromBedIndex: number, toBedIndex: number): DormRoom[] {
  if (fromBedIndex === toBedIndex) return rooms;
  const next = cloneDormRooms(rooms);
  const room = next[roomIndex];
  if (!room || fromBedIndex < 0 || fromBedIndex >= room.beds.length || toBedIndex < 0) return rooms;
  while (room.beds.length <= toBedIndex) room.beds.push(null);
  const [bed] = room.beds.splice(fromBedIndex, 1);
  room.beds.splice(toBedIndex, 0, bed ?? null);
  return next;
}
