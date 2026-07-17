import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { findProjectRoot } from "../server/projectRoot.js";

test("findProjectRoot resolves source and compiled server layouts", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kid-reading-project-root-"));
  const projectDir = path.join(temporaryRoot, "project");
  const unrelatedCwd = path.join(temporaryRoot, "elsewhere");

  try {
    fs.mkdirSync(path.join(projectDir, "server"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".server-build", "server"), { recursive: true });
    fs.mkdirSync(unrelatedCwd, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "package.json"), "{}\n");

    const sourceModuleUrl = pathToFileURL(path.join(projectDir, "server", "projectRoot.ts")).href;
    const compiledModuleUrl = pathToFileURL(path.join(projectDir, ".server-build", "server", "projectRoot.js")).href;

    assert.equal(findProjectRoot(sourceModuleUrl, unrelatedCwd), projectDir);
    assert.equal(findProjectRoot(compiledModuleUrl, unrelatedCwd), projectDir);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
