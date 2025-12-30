import { ReflowService } from "./reflow/reflow.service.js";
import { type WorkCenter, type WorkOrder } from "./reflow/types.js";

// import SmallWorkOrdersJSON from './data/small-orders.json' with {type: 'json'}
import WorkCentersJSON from './data/work-centers.json' with {type: 'json'}

// Test circular dependencies
// import CircularDependencyJson from './data/work-orders-75-with-cycles.json' with {type: 'json'}
// const rs = new ReflowService(WorkCentersJSON as WorkCenter[], CircularDependencyJson as WorkOrder[])

// Test single work center
import SingleWorkCenterJSON from './data/work-orders-75.json' with {type: 'json'}
const rs = new ReflowService(WorkCentersJSON as WorkCenter[], SingleWorkCenterJSON as WorkOrder[]);

const results = rs.reflow()

console.log(`results: ${JSON.stringify(results, null, 3)}`);
