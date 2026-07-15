import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

process.env.HOST ||= "127.0.0.1";
process.env.PORT ||= "4175";
process.env.NODE_ENV ||= "development";
process.env.KID_READING_DATA_DIR ||= path.join(__dirname, "data", "dev");
process.env.KID_READING_SAVE_AUDIO ||= "0";
process.env.SPEECH_ENHANCEMENT_PROVIDER ||= "disabled";
process.env.SPEECH_ENHANCEMENT_AB ||= "0";
process.env.LOCAL_COURSE_STUDIO_ENABLED ||= "1";

const { app } = await import("./index.js");
const port = Number(process.env.PORT);
const host = process.env.HOST;

app.listen(port, host, () => {
  console.log(`Kid English Reading development API listening on http://${host}:${port}`);
});
