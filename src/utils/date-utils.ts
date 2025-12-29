import { DateTime } from 'luxon';
import { WorkCenter, WorkOrder, Shift } from '../reflow/types';

export function calculateEndDateWithShifts(
  workOrder: WorkOrder,
  workCenter: WorkCenter
): string {
  let current = DateTime.fromISO(workOrder.data.startDate, { zone: 'utc' });
  let remainingMinutes = workOrder.data.durationMinutes;

  // Safety check to prevent infinite loops
  let maxIterations = 10000;
  let iterations = 0;

  while (remainingMinutes > 0 && iterations < maxIterations) {
    iterations++;

    // Check if current time is in a maintenance window
    const isTimeInMaintenanceWindow = isInMaintenanceWindow(current.toISO(), workCenter);
    if (isTimeInMaintenanceWindow) {
      // Skip to end of maintenance window
      const nextAvailable = getNextAvailableTime(current.toISO(), workCenter);
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

  return current.toISO();
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
  const { shifts, maintenanceWindows } = workCenter.data;

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
    return getNextAvailableTime(current.toISO(), workCenter);
  }

  const shiftStart = current.set({ hour: shift.startHour, minute: 0, second: 0 });
  if (current < shiftStart) {
    current = shiftStart;
  }

  return current.toISO();
}

export function getMinutesDiff(start: string, end: string): number {
  const startDt = DateTime.fromISO(start, { zone: 'utc' });
  const endDt = DateTime.fromISO(end, { zone: 'utc' });

  return endDt.diff(startDt, 'minutes').minutes;
}
