import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--dev")) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  process.env.KID_READING_DATA_DIR ||= path.join(__dirname, "..", "server", "data", "dev");
}

const labelIndex = args.indexOf("--label");
const label = labelIndex >= 0 ? String(args[labelIndex + 1] || "") : "";
const daysIndex = args.indexOf("--days");
const days = daysIndex >= 0 ? Math.max(1, Number(args[daysIndex + 1] || 30)) : 30;

const { initDatabase } = await import("../server/db.js");
const { createRegistrationKey } = await import("../server/parentAuth.js");
initDatabase();
const result = createRegistrationKey({
  label,
  maxUses: 1,
  expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
});

console.log(`Registration key: ${result.key}`);
console.log(`Expires at: ${result.expiresAt}`);
