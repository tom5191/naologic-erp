import { ReflowService } from "./reflow/reflow.service";

import WorkCentersJSON from './data/work-centers.json'
import WorkOrdersJSON from './data/work-orders.json'

const rs = new ReflowService(WorkCentersJSON, WorkOrdersJSON)

console.log(rs.reflow());
