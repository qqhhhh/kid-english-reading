import {
  getPaddleOcrStatus,
  startPaddleOcrService,
  stopPaddleOcrService
} from "../server/providers/paddleOcr.js";

const action = process.argv[2] || "status";

const status = action === "start"
  ? await startPaddleOcrService()
  : action === "stop"
    ? await stopPaddleOcrService()
    : await getPaddleOcrStatus();

console.log(JSON.stringify(status, null, 2));
