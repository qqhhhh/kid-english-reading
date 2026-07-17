import {
  getHunyuanOcrStatus,
  startHunyuanOcrService,
  stopHunyuanOcrService
} from "../server/providers/hunyuanOcr.js";

const action = process.argv[2] || "status";

const status = action === "start"
  ? await startHunyuanOcrService()
  : action === "stop"
    ? await stopHunyuanOcrService()
    : await getHunyuanOcrStatus();

console.log(JSON.stringify(status, null, 2));
