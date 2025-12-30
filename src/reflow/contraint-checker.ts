import { DateTime } from 'luxon'
import { type WorkCenter, type WorkOrder, type Schedule } from './types.js';

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

    // Check to see if the dependency has already completed
    if (depEnd > woStart) {
      return false;
    }
  }

  return true;
}

/* 
* Determine if there are any circular dependancies within work order dependencies
*/
export function detectCircularDependencies(workOrders: WorkOrder[]): string[] {
  const errors: string[] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();

  const woMap = new Map(
    workOrders.map(wo => [wo.docId, wo])
  );

  const dfs = (woId: string, path: string[]): void => {
    if (recStack.has(woId)) {
      errors.push(
        `Circular dependency detected: ${[...path, woId].join(" → ")}`
      );
      return;
    }

    if (visited.has(woId)) {
      return;
    }

    recStack.add(woId);

    const wo = woMap.get(woId);
    if (wo) {
      for (const depId of wo.data.dependsOnWorkOrderIds) {
        dfs(depId, [...path, woId]);
      }
    }

    recStack.delete(woId);
    visited.add(woId);
  };

  for (const wo of workOrders) {
    if (!visited.has(wo.docId)) {
      dfs(wo.docId, []);
    }
  }

  return errors;
}


/**
 * Validate all constraints for a schedule
 */
export function validateSchedule(
  schedule: Schedule,
  workCenters: WorkCenter[]
): { valid: boolean, errors: string[] } {
  const errors: string[] = [];

  // Check each work order
  for (const center of Object.keys(schedule)) {
    const workOrders = schedule[center]

    // Check for circular dependencies for each work center schedule group
    const circularErrors = detectCircularDependencies(workOrders);
    if (circularErrors.length > 0) {
      errors.push(...circularErrors);
    }

    for (const wo of workOrders) {

      if (!areDependenciesSatisfied(wo, workOrders)) {
        errors.push(`Work order ${wo.docId} starts before dependencies complete`);
      }
      // Check work center has conflicts
      const conflicts = workOrders.filter(other =>
        other.docId !== wo.docId && hasWorkCenterConflict(wo, other)
      );

      if (conflicts.length > 0) {
        errors.push(
          `Work order ${wo.docId} conflicts with ${conflicts.map(c => c.docId).join(', ')} on work center ${wo.data.workCenterId}`
        );
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
            errors.push(
              `Work order ${wo.docId} conflicts with maintenance window on ${wc.data.name}`
            );
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
