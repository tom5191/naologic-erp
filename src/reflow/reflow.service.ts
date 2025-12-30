import { type WorkOrder, type WorkCenter, type ScheduleChange, type ReflowResult, type Schedule } from "./types.js";
import { validateSchedule, hasWorkCenterConflict, detectCircularDependencies } from "./contraint-checker.js";
import { getNextAvailableTime, calculateEndDateWithShifts, getMinutesDiff } from "../utils/date-utils.js";
import { DateTime } from 'luxon';

export class ReflowService {
  private schedule: Schedule = {};
  private workCenterSchedules: Schedule = {};
  private workCenters: WorkCenter[] = [];
  private workOrders: WorkOrder[] = [];
  private changes: ScheduleChange[] = [];

  constructor(workCenters: WorkCenter[], workOrders: WorkOrder[]) {
    this.workCenters = workCenters;
    this.workOrders = workOrders;
  }

  public reflow(): ReflowResult {
    for (let wc of this.workCenters) {
      this.workCenterSchedules[wc.docId] = this.workOrders.filter(wo => wo.data.workCenterId === wc.docId);
    }

    if (this.workOrders.length === 0) {
      return {
        success: false,
        updatedWorkOrders: {},
        changes: [],
        explanation: 'Cannot reflow: no work orders were passed',
      }
    }

    // Validate input
    const circularErrors = detectCircularDependencies(this.workOrders);
    if (circularErrors.length > 0) {
      return {
        success: false,
        updatedWorkOrders: {},
        changes: [],
        explanation: 'Cannot reflow: circular dependencies detected',
        errors: circularErrors
      };
    }

    // Create a working array that we'll modify as we process
    let workingOrders = [...this.workOrders];
    let processedCount = 0;
    const maxIterations = this.workOrders.length * 100; // Safety limit

    while (workingOrders.length > 0 && processedCount < maxIterations) {
      processedCount++;

      // Take the first order from the working array
      const order: WorkOrder | undefined = workingOrders.shift();

      if (!order) {
        return {
          success: false,
          updatedWorkOrders: {},
          changes: [],
          explanation: 'Cannot reflow: no order found in array'
        }
      }

      const originalOrder = { ...order, data: { ...order.data } }

      if (!Object.hasOwn(this.schedule, order.data.workCenterId)) {
        this.schedule[order.data.workCenterId] = [];
      }

      // Check if already processed
      const hasBeenProcessed = this.schedule[order.data.workCenterId]?.find(s => s.docId === order.docId);
      if (hasBeenProcessed) {
        continue;
      }

      // Check if dependencies exist
      const totalDependencies = order.data.dependsOnWorkOrderIds.length;

      if (totalDependencies > 0) {
        let unprocessedDependencies: WorkOrder[] = [];

        // Check each dependency
        for (let dependencyOrderId of order.data.dependsOnWorkOrderIds) {
          const dependencyHasBeenProcessed = this.schedule[order.data.workCenterId]?.find(s => s.docId === dependencyOrderId);

          if (dependencyHasBeenProcessed) {
            // Dependency already processed, continue to next dependency
            continue;
          } else {
            // Dependency not processed yet, find it and add to unprocessed list
            const dependencyWorkOrder = this.workOrders.find(wo => wo.docId === dependencyOrderId);
            if (dependencyWorkOrder) {
              unprocessedDependencies.push(dependencyWorkOrder);
            } else {
              throw new Error(`Dependency ${dependencyOrderId} not found for work order ${order.docId}`);
            }
          }
        }

        // If there are unprocessed dependencies, add them to front of queue
        if (unprocessedDependencies.length > 0) {
          // Add unprocessed dependencies to the front
          workingOrders.unshift(...unprocessedDependencies);
          // Add current order back after dependencies
          workingOrders.push(order);
          continue;
        }
      }

      // Skip maintenance work orders (cannot be rescheduled)
      if (order.data.isMaintenance) {
        this.addToWorkCenterSchedule(order);
        continue;
      }

      // Calculate new end date with shifts and maintenance
      const workCenter = this.workCenters.find(wc => wc.docId === order.data.workCenterId);
      if (!workCenter) {
        throw new Error(`Work center ${order.data.workCenterId} not found`);
      }

      // Find earliest valid start time
      const newStartDate = this.findEarliestStartTime(order);
      const newEndDate = calculateEndDateWithShifts(order, workCenter);

      // Update work order
      order.data.startDate = newStartDate;
      order.data.endDate = newEndDate;

      this.addToWorkCenterSchedule(order);

      // Track changes
      if (originalOrder.data.startDate !== newStartDate || originalOrder.data.endDate !== newEndDate) {
        const delayMinutes = getMinutesDiff(originalOrder.data.endDate, newEndDate);
        this.changes.push({
          workOrderId: order.docId,
          workOrderNumber: order.data.workOrderNumber,
          oldStart: originalOrder.data.startDate,
          oldEnd: originalOrder.data.endDate,
          newStart: newStartDate,
          newEnd: newEndDate,
          delayMinutes: Math.max(0, delayMinutes),
          reason: this.determineChangeReason(order, originalOrder, this.schedule[order.data.workCenterId])
        });
      }
    }


    if (processedCount >= maxIterations) {
      return {
        success: false,
        updatedWorkOrders: {},
        changes: [],
        explanation: 'Max iterations reached - possible infinite loop or circular dependency',
        errors: ['Processing exceeded maximum iterations']
      };
    }

    // Validate final schedule
    const validation = validateSchedule(this.schedule, this.workCenters);

    return {
      success: validation.valid,
      updatedWorkOrders: this.schedule,
      changes: this.changes,
      explanation: this.generateExplanation(this.changes, validation),
      errors: validation.errors,
    };
  }

  /**
   * Find earliest valid start time considering all constraints
   */
  private findEarliestStartTime(
    workOrder: WorkOrder
  ): string {
    const workCenter = this.workCenters.find(wc => wc.docId === workOrder.data.workCenterId);
    if (!workCenter) {
      throw new Error(`Work center ${workOrder.data.workCenterId} not found`);
    }

    const workCenterSchedule = this.workCenterSchedules[workCenter.docId];

    // Start with dependency constraints
    let earliestStart = this.getEarliestStartAfterDependencies(workOrder, workCenterSchedule);

    if (!earliestStart) {
      throw new Error(`Error trying to find earliest start time for work center ${workOrder.data.workCenterId}`);
    }

    // Ensure we're in a valid shift
    earliestStart = getNextAvailableTime(earliestStart, workCenter);

    // Check for work center conflicts and adjust if needed
    earliestStart = this.resolveWorkCenterConflict(
      earliestStart,
      workOrder,
      workCenterSchedule,
      workCenter
    );

    return earliestStart;
  }

  private getEarliestStartAfterDependencies(
    workOrder: WorkOrder,
    scheduledWorkOrders: WorkOrder[]
  ): string | null {
    let latestDependencyEnd = DateTime.fromISO(workOrder.data.startDate, { zone: 'utc' });

    for (const depId of workOrder.data.dependsOnWorkOrderIds) {
      const dependency = scheduledWorkOrders.find(wo => wo.docId === depId);

      if (dependency) {
        const depEnd = DateTime.fromISO(dependency.data.endDate, { zone: 'utc' });
        if (depEnd > latestDependencyEnd) {
          latestDependencyEnd = depEnd;
        }
      }
    }

    return latestDependencyEnd.toISO();
  }

  private resolveWorkCenterConflict(
    proposedStart: string,
    workOrder: WorkOrder,
    existingOrders: WorkOrder[],
    workCenter: WorkCenter
  ): string {
    let currentStart = proposedStart;

    // Keep iterating until we find an open time slot
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const proposedEnd = calculateEndDateWithShifts(
        workOrder,
        workCenter
      );

      const tempWo: WorkOrder = {
        ...workOrder,
        data: {
          ...workOrder.data,
          startDate: currentStart,
          endDate: proposedEnd
        }
      };

      // Check for conflicts
      const hasConflict = existingOrders.some(existing => hasWorkCenterConflict(tempWo, existing));

      if (!hasConflict) {
        return currentStart;
      }

      // Find the conflicting order that ends latest
      const conflictingOrders = existingOrders.filter(existing => hasWorkCenterConflict(tempWo, existing));

      const latestConflictEnd = conflictingOrders.reduce((latest, wo) => {
        const woEnd = DateTime.fromISO(wo.data.endDate, { zone: 'utc' });
        return woEnd > latest ? woEnd : latest;
      }, DateTime.fromISO(currentStart, { zone: 'utc' }));

      const latestToIso = latestConflictEnd.toISO()
      if (latestToIso) {
        // Move start to after the conflict
        currentStart = getNextAvailableTime(latestToIso, workCenter);
      }

      attempts++;
    }

    throw new Error(`Could not resolve work center conflict for ${workOrder.docId} after ${maxAttempts} attempts`);
  }

  private addToWorkCenterSchedule(workOrder: WorkOrder): void {
    const wcId = workOrder.data.workCenterId;
    const wId = workOrder.docId;
    const alreadyAdded = this.schedule[wcId].find(s => s.docId === wId);

    if (!alreadyAdded) {
      this.schedule[wcId].push(workOrder);
    }
  }

  private determineChangeReason(
    newWo: WorkOrder,
    oldWo: WorkOrder,
    allWorkOrders: WorkOrder[]
  ): string {
    const reasons: string[] = [];

    // Check if delayed by dependencies
    for (const depId of newWo.data.dependsOnWorkOrderIds) {
      const dep = allWorkOrders.find(wo => wo.docId === depId);
      const oldDep = allWorkOrders.find(wo => wo.docId === depId);

      if (dep && oldDep) {
        const newDepEnd = DateTime.fromISO(dep.data.endDate, { zone: 'utc' });
        const oldStart = DateTime.fromISO(oldWo.data.startDate, { zone: 'utc' });

        if (newDepEnd > oldStart) {
          reasons.push(`Dependency ${depId} delayed`);
        }
      }
    }

    // Check if delayed by work center conflict
    const sameWcOrders = allWorkOrders.filter(wo =>
      wo.data.workCenterId === newWo.data.workCenterId && wo.docId !== newWo.docId
    );

    if (reasons.length === 0 && sameWcOrders.length > 0) {
      reasons.push('Work center conflict');
    }

    if (reasons.length === 0) {
      reasons.push('Shift or maintenance constraint');
    }

    return reasons.join('; ');
  }

  private generateExplanation(
    changes: ScheduleChange[],
    validation: { valid: boolean; errors: string[] }
  ): string {
    if (!validation.valid) {
      return `Schedule validation failed: ${validation.errors.join('; ')}`;
    }

    if (changes.length === 0) {
      return 'No changes required - schedule is already valid';
    }

    const totalDelay = changes.reduce((sum, c) => sum + c.delayMinutes, 0);

    return `Rescheduled ${changes.length} work order(s) with total delay of ${totalDelay} minutes. ${validation.valid ? 'All constraints satisfied.' : 'Validation issues remain.'
      }`;
  }
}