import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function findProjectRoot(moduleUrl = import.meta.url, cwd = process.cwd()): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    path.resolve(moduleDir, ".."),
    path.resolve(moduleDir, "..", ".."),
    path.resolve(cwd)
  ];

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "package.json"))) || path.resolve(cwd);
}

export const projectRoot = findProjectRoot();
