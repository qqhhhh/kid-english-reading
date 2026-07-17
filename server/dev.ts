import path from "node:path";
import { projectRoot } from "./projectRoot.js";

try {
  process.loadEnvFile(path.join(projectRoot, ".env"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

process.env.HOST ||= "127.0.0.1";
process.env.PORT ||= "4175";
process.env.NODE_ENV ||= "development";
process.env.KID_READING_DATA_DIR ||= path.join(projectRoot, "server", "data", "dev");
process.env.KID_READING_SAVE_AUDIO ||= "1";
process.env.SPEECH_ENHANCEMENT_PROVIDER ||= "gtcrn";
process.env.SPEECH_ENHANCEMENT_AB ||= "1";
process.env.LOCAL_COURSE_STUDIO_ENABLED ||= "1";
process.env.TENCENT_STREAMING_ENABLED ||= "1";

const { app, attachLiveSpeechServer } = await import("./index.js");
const port = Number(process.env.PORT);
const host = process.env.HOST;

const server = app.listen(port, host, () => {
  console.log(`Kid English Reading development API listening on http://${host}:${port}`);
});
attachLiveSpeechServer(server);
