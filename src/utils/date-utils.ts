import { DateTime } from 'luxon';
import { type WorkCenter, type WorkOrder, type Shift } from '../reflow/types.js';

export function calculateEndDateWithShifts(
  workOrder: WorkOrder,
  workCenter: WorkCenter
): string {
  let current = DateTime.fromISO(workOrder.data.startDate, { zone: 'utc' });
  let currentIsoTime = current.toISO()
  let remainingMinutes = workOrder.data.durationMinutes;

  if (!current || !currentIsoTime) {
    throw new Error(`Unable to create current time from start date for work order ${workOrder.docId}`)
  }

  // Safety check to prevent infinite loops
  let maxIterations = 10000;
  let iterations = 0;

  while (remainingMinutes > 0 && iterations < maxIterations) {
    iterations++;

    // Check if current time is in a maintenance window
    const isTimeInMaintenanceWindow = isInMaintenanceWindow(currentIsoTime, workCenter);
    if (isTimeInMaintenanceWindow) {
      // Skip to end of maintenance window
      const nextAvailable = getNextAvailableTime(currentIsoTime, workCenter);
      current = DateTime.fromISO(nextAvailable, { zone: 'utc' });
      continue;
    }

    // Get shift for current day
    const shift = getShiftForDay(current.weekday % 7, workCenter);

    if (!shift) {
      // If there's no shift today, move to next start of next day.
      current = current.plus({ days: 1 }).startOf('day');
      continue;
    }

    // Create start/end shift for current day
    const shiftStart = current.set({ hour: shift.startHour, minute: 0, second: 0 });
    const shiftEnd = current.set({ hour: shift.endHour, minute: 0, second: 0 });

    // If before shift, jump to shift start
    if (current < shiftStart) {
      current = shiftStart;
      continue;
    }

    // If after shift, move to next day
    if (current >= shiftEnd) {
      current = current.plus({ days: 1 }).startOf('day');
      continue;
    }

    // Find remaining minutes for current shift
    const availableMinutes = shiftEnd.diff(current, 'minutes').minutes;
    const minutesToWork = Math.min(remainingMinutes, availableMinutes);

    current = current.plus({ minutes: minutesToWork });
    remainingMinutes -= minutesToWork;

    // If we've used all available time in shift, move to next day
    if (remainingMinutes > 0 && current >= shiftEnd) {
      current = current.plus({ days: 1 }).startOf('day');
    }
  }

  if (iterations >= maxIterations) {
    throw new Error('Infinite loop detected in date calculation');
  }

  const returnIsoTIme = current.toISO();

  if (!returnIsoTIme) {
    throw new Error(`Error calculating final iso time for ${workOrder.docId}`);
  }

  return returnIsoTIme;
}

export function getShiftForDay(dayOfWeek: number, workCenter: WorkCenter): Shift | null {
  const { shifts } = workCenter.data;
  return shifts.find(s => s.dayOfWeek === dayOfWeek) || null;
}

export function isInMaintenanceWindow(date: string, workCenter: WorkCenter): boolean {
  const { maintenanceWindows } = workCenter.data;
  const dt = DateTime.fromISO(date, { zone: 'utc' });

  return maintenanceWindows.some(w => {
    const start = DateTime.fromISO(w.startDate, { zone: 'utc' });
    const end = DateTime.fromISO(w.endDate, { zone: 'utc' });
    return dt >= start && dt < end;
  });
}

export function getNextAvailableTime(
  date: string,
  workCenter: WorkCenter
): string {
  let current = DateTime.fromISO(date, { zone: 'utc' });
  const { maintenanceWindows } = workCenter.data;

  // Find the maintenance window we're in
  const inWindow = maintenanceWindows.find(w => {
    const start = DateTime.fromISO(w.startDate, { zone: 'utc' });
    const end = DateTime.fromISO(w.endDate, { zone: 'utc' });
    return current >= start && current < end;
  });

  if (inWindow) {
    current = DateTime.fromISO(inWindow.endDate, { zone: 'utc' });
  }

  // Make sure we're in a shift
  const shift = getShiftForDay(current.weekday % 7, workCenter);
  if (!shift) {
    current = current.plus({ days: 1 }).startOf('day');
    const noShiftIsoTIme = current.toISO()
    if (!noShiftIsoTIme) {
      throw new Error(`Error converting time to iso time for no shift ${workCenter.docId}`);
    }

    return getNextAvailableTime(noShiftIsoTIme, workCenter);
  }

  const shiftStart = current.set({ hour: shift.startHour, minute: 0, second: 0 });
  if (current < shiftStart) {
    current = shiftStart;
  }

  const returnIsoTime = current.toISO();

  if (!returnIsoTime) {
    throw new Error(`Error converting time to iso time for ${workCenter.docId}`);
  }

  return returnIsoTime;
}

export function getMinutesDiff(start: string, end: string): number {
  const startDt = DateTime.fromISO(start, { zone: 'utc' });
  const endDt = DateTime.fromISO(end, { zone: 'utc' });

  return endDt.diff(startDt, 'minutes').minutes;
}
