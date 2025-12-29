import { WorkOrder, WorkCenter, ReflowInput, ReflowResult, Schedule } from "./types";
import { validateSchedule, hasWorkCenterConflict } from "./contraint-checker";
import { getNextAvailableTime, calculateEndDateWithShifts } from "../utils/date-utils";
import { DateTime } from 'luxon';

export class ReflowService {
  private schedule: Schedule = {};
  private workCenterSchedules: Schedule = {};
  private workCenters: WorkCenter[] = [];
  private workOrders: WorkOrder[] = [];

  constructor(workCenters, workOrders) {
    this.workCenters = workCenters;
    this.workOrders = workOrders;
  }

  public reflow(): ReflowResult {
    for (let wc of this.workCenters) {
      this.workCenterSchedules[wc.docId] = this.workOrders.filter(wo => wo.data.workCenterId === wc.docId);
    }

    // Create a working array that we'll modify as we process
    let workingOrders = [...this.workOrders];
    let processedCount = 0;
    const maxIterations = this.workOrders.length * 100; // Safety limit

    while (workingOrders.length > 0 && processedCount < maxIterations) {
      processedCount++;

      // Take the first order from the working array
      const order = workingOrders.shift()!;

      // Check if already processed
      const hasBeenProcessed = this.schedule[order.data.workCenterId].find(s => s.docId === order.docId);
      if (hasBeenProcessed) {
        continue;
      }

      // Check if dependencies exist
      const totalDependencies = order.data.dependsOnWorkOrderIds.length;

      if (totalDependencies > 0) {
        let unprocessedDependencies: WorkOrder[] = [];
        let allDependenciesProcessed = true;

        // Check each dependency
        for (let dependencyOrderId of order.data.dependsOnWorkOrderIds) {
          const dependencyHasBeenProcessed = this.schedule[order.data.workCenterId].find(s => s.docId === dependencyOrderId);

          if (dependencyHasBeenProcessed) {
            // Dependency already processed, continue to next dependency
            continue;
          } else {
            // Dependency not processed yet, find it and add to unprocessed list
            const dependencyWorkOrder = this.workOrders.find(wo => wo.docId === dependencyOrderId);
            if (dependencyWorkOrder) {
              unprocessedDependencies.push(dependencyWorkOrder);
              allDependenciesProcessed = false;
            } else {
              throw new Error(`Dependency ${dependencyOrderId} not found for work order ${order.docId}`);
            }
          }
        }

        // If there are unprocessed dependencies, add them to front of queue
        if (!allDependenciesProcessed) {
          // Add unprocessed dependencies to the front
          workingOrders.unshift(...unprocessedDependencies);
          // Add current order back after dependencies
          workingOrders.push(order);
          continue;
        }
      }

      // All dependencies processed (or no dependencies), process this order

      // Skip maintenance work orders (cannot be rescheduled)
      if (order.data.isMaintenance) {
        this.schedule[order.data.workCenterId].push(order);
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

      this.schedule[order.data.workCenterId].push(order);
      this.addToWorkCenterSchedule(order);
    }

    if (processedCount >= maxIterations) {
      return {
        success: false,
        updatedWorkOrders: {},
      };
    }

    // Validate final schedule
    const validation = validateSchedule(this.schedule, this.workCenters);

    return {
      success: validation.valid,
      updatedWorkOrders: this.schedule,
    };
  }

  /**
   * Topological sort using DFS
   */
  private topologicalSort(workOrders: WorkOrder[]): WorkOrder[] {
    const sorted: WorkOrder[] = [];
    const visited = new Set<string>();
    const woMap = new Map(workOrders.map(wo => [wo.docId, wo]));

    const visit = (woId: string) => {
      if (visited.has(woId)) return;
      visited.add(woId);

      const wo = woMap.get(woId);
      if (!wo) return;

      // Visit dependencies first
      for (const depId of wo.data.dependsOnWorkOrderIds) {
        visit(depId);
      }

      sorted.push(wo);
    };

    for (const wo of workOrders) {
      visit(wo.docId);
    }

    return sorted;
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
  ): string {
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

      // Move start to after the conflict
      currentStart = getNextAvailableTime(latestConflictEnd.toISO(), workCenter);

      attempts++;
    }

    throw new Error(`Could not resolve work center conflict for ${workOrder.docId} after ${maxAttempts} attempts`);
  }

  private addToWorkCenterSchedule(workOrder: WorkOrder): void {
    const wcId = workOrder.data.workCenterId;
    const alreadyAdded = this.schedule[wcId].find(s => s.docId === wcId);

    if (!alreadyAdded) {
      this.schedule[wcId].push(workOrder);
    }
  }
}