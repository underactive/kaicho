import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { RepoContext } from "./fingerprint.js";
import { readSafe, exists, findXcodeproj } from "./fingerprint.js";
import {
  detectFromPackageJson,
  detectFromCargoToml,
  detectFromPyprojectToml,
  detectFromPlatformioIni,
  detectFromGoMod,
  detectFromGradle,
  detectFromPomXml,
  detectFromSwiftProject,
} from "./detectors.js";

const MAX_SUBDIRS = 10;

/**
 * Scan immediate subdirectories for manifest files.
 * Used when the root has no language signals — catches multi-project repos
 * like firmware/ + macos/ that aren't formal monorepos.
 */
export async function scanSubdirectories(root: string, ctx: RepoContext): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "build" && e.name !== "dist")
    .slice(0, MAX_SUBDIRS);

  for (const dir of dirs) {
    const dirPath = path.join(root, dir.name);
    const rel = dir.name;

    const [pkgJson, cargoToml, pyproject, platformioIni, goMod, gradle, gradleKts, pomXml] = await Promise.all([
      readSafe(path.join(dirPath, "package.json")),
      readSafe(path.join(dirPath, "Cargo.toml")),
      readSafe(path.join(dirPath, "pyproject.toml")),
      readSafe(path.join(dirPath, "platformio.ini")),
      readSafe(path.join(dirPath, "go.mod")),
      readSafe(path.join(dirPath, "build.gradle")),
      readSafe(path.join(dirPath, "build.gradle.kts")),
      readSafe(path.join(dirPath, "pom.xml")),
    ]);

    if (pkgJson) detectFromPackageJson(pkgJson, ctx, `${rel}/package.json`);
    if (cargoToml) detectFromCargoToml(cargoToml, ctx, `${rel}/Cargo.toml`);
    if (pyproject) detectFromPyprojectToml(pyproject, ctx, `${rel}/pyproject.toml`);
    if (platformioIni) detectFromPlatformioIni(platformioIni, ctx, `${rel}/platformio.ini`);
    if (goMod) detectFromGoMod(goMod, ctx);
    if (gradle) detectFromGradle(gradle, ctx, `${rel}/build.gradle`);
    else if (gradleKts) detectFromGradle(gradleKts, ctx, `${rel}/build.gradle.kts`);
    if (pomXml) detectFromPomXml(pomXml, ctx, `${rel}/pom.xml`);

    // Check for Swift/Xcode projects in subdirs (and one level deeper)
    await detectSwiftInDir(dirPath, rel, ctx);
  }
}

/**
 * Look for Swift/Xcode project signals in a directory.
 * If nothing is found, peek one level deeper (handles macos/AppName/ pattern).
 */
async function detectSwiftInDir(dirPath: string, rel: string, ctx: RepoContext): Promise<void> {
  const swiftPkg = await exists(path.join(dirPath, "Package.swift"));
  if (swiftPkg) { detectFromSwiftProject(ctx, `${rel}/Package.swift`); return; }

  const projYml = await exists(path.join(dirPath, "project.yml"));
  if (projYml) { detectFromSwiftProject(ctx, `${rel}/project.yml`); return; }

  const xcodeproj = await findXcodeproj(dirPath);
  if (xcodeproj) { detectFromSwiftProject(ctx, `${rel}/${xcodeproj}`); return; }

  // One level deeper: check child directories (handles macos/AppName/ pattern)
  try {
    const children = await fs.readdir(dirPath, { withFileTypes: true });
    const childDirs = children.filter((e) => e.isDirectory() && !e.name.startsWith(".")).slice(0, 5);
    for (const child of childDirs) {
      const childPath = path.join(dirPath, child.name);
      const childRel = `${rel}/${child.name}`;

      const childSwiftPkg = await exists(path.join(childPath, "Package.swift"));
      if (childSwiftPkg) { detectFromSwiftProject(ctx, `${childRel}/Package.swift`); return; }

      const childProjYml = await exists(path.join(childPath, "project.yml"));
      if (childProjYml) { detectFromSwiftProject(ctx, `${childRel}/project.yml`); return; }

      const childXcodeproj = await findXcodeproj(childPath);
      if (childXcodeproj) { detectFromSwiftProject(ctx, `${childRel}/${childXcodeproj}`); return; }
    }
  } catch {
    // skip
  }
}
