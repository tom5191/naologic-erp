export type WorkOrder = {
  docId: string;
  docType: "workOrder";
  data: {
    workOrderNumber: string;
    manufacturingOrderId: string;
    workCenterId: string;

    // Timing
    startDate: string;
    endDate: string;
    durationMinutes: number;        // Total working time required

    // Constraints
    isMaintenance: boolean;         // Cannot be rescheduled if true

    // Dependencies (can have multiple parents)
    dependsOnWorkOrderIds: string[]; // All must complete before this starts
  }
}

export type WorkCenter = {
  docId: string;
  docType: "workCenter";
  data: {
    name: string;

    // Shifts
    shifts: Array<Shift>;

    // Maintenance windows (blocked time periods)
    maintenanceWindows: Array<MaintenanceWindow>;

    // Orders for center
    orders?: WorkOrder[]
  }
};

export type Shift = {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
}
export type MaintenanceWindow = {
  startDate: string;
  endDate: string;
  reason?: string;             // Optional description
}

export type ReflowParams = {
  workOrders: WorkOrder[],
  centers: WorkCenter[],
  manufacturingOrders: ManufacturingOrder[]
}

export type ManufacturingOrderData = {
  manufacturingOrderNumber: string;
  itemId: string;
  quantity: number;
  dueDate: string;
}

export type ManufacturingOrder = {
  docId: string;
  docType: 'manufacturingOrder';
  data: ManufacturingOrderData;
}

export type ReflowResult = {
  success: boolean;
  updatedWorkOrders: Schedule;
}

export type ReflowInput = {
  workOrders: WorkOrder[];
  workCenters: WorkCenter[];
  manufacturingOrders?: ManufacturingOrder[];
  disruptionStartTime?: string; // Optional: when disruption occurred
}

export type Schedule = {
  [key: string]: WorkOrder[]
}