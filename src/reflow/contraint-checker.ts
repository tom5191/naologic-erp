import { DateTime } from 'luxon'
import { WorkCenter, WorkOrder, Schedule } from './types';

/**
 * Check if two work orders overlap on the same work center
 */
export function hasWorkCenterConflict(wo1: WorkOrder, wo2: WorkOrder): boolean {
  if (wo1.data.workCenterId !== wo2.data.workCenterId) {
    return false;
  }

  const start1 = DateTime.fromISO(wo1.data.startDate, { zone: 'utc' });
  const end1 = DateTime.fromISO(wo1.data.endDate, { zone: 'utc' });
  const start2 = DateTime.fromISO(wo2.data.startDate, { zone: 'utc' });
  const end2 = DateTime.fromISO(wo2.data.endDate, { zone: 'utc' });

  // Check for overlap: starts before other ends AND ends after other starts
  return start1 < end2 && end1 > start2;
}

/**
 * Check if dependencies are satisfied
 */
export function areDependenciesSatisfied(
  workOrder: WorkOrder,
  allWorkOrders: WorkOrder[]
): boolean {
  const woStart = DateTime.fromISO(workOrder.data.startDate, { zone: 'utc' });

  for (const depId of workOrder.data.dependsOnWorkOrderIds) {
    const dependency = allWorkOrders.find(wo => wo.docId === depId);

    if (!dependency) {
      return false;
    }

    const depEnd = DateTime.fromISO(dependency.data.endDate, { zone: 'utc' });

    // Check if dependency has finished
    if (depEnd > woStart) {
      return false;
    }
  }

  return true;
}

/**
 * Validate all constraints for a schedule
 */
export function validateSchedule(
  schedule: Schedule,
  workCenters: WorkCenter[]
): { valid: boolean } {
  let isValid = true;
  // Check each work order
  for (const center of Object.keys(schedule)) {
    const workOrders = schedule[center]
    for (const wo of workOrders) {
      // Check work center conflicts
      const conflicts = workOrders.filter(other =>
        other.docId !== wo.docId && hasWorkCenterConflict(wo, other)
      );

      if (conflicts.length > 0) {
        // TODO: Update erro handling
        console.error('Conflicts found: ', JSON.stringify(conflicts));
        isValid = false;
      }

      // Check maintenance windows
      const wc = workCenters.find(wc => wc.docId === wo.data.workCenterId);

      if (wc) {
        const woStart = DateTime.fromISO(wo.data.startDate, { zone: 'utc' });
        const woEnd = DateTime.fromISO(wo.data.endDate, { zone: 'utc' });

        for (const mw of wc.data.maintenanceWindows) {
          const mwStart = DateTime.fromISO(mw.startDate, { zone: 'utc' });
          const mwEnd = DateTime.fromISO(mw.endDate, { zone: 'utc' });

          if (woStart < mwEnd && woEnd > mwStart) {
            // TODO update error handling for maintenance window
            isValid = false;
          }
        }
      }
    }
  }

  return { valid: isValid };
}
