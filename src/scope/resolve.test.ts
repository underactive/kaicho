import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveScope, buildFileManifest } from "./resolve.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";

const mockExeca = vi.mocked(execa);

const MOCK_FILES = [
  "src/app.ts",
  "src/utils/helpers.ts",
  "src/api/routes.ts",
  "lib/core.js",
  "lib/utils.js",
  "README.md",
  "package.json",
  "tests/app.test.ts",
  "docs/guide.md",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  mockExeca.mockImplementation((() =>
    Promise.resolve({ exitCode: 0, stdout: MOCK_FILES, stderr: "" })
  ) as unknown as typeof execa);
});

describe("resolveScope", () => {
  it("returns null when no scope options provided", async () => {
    const result = await resolveScope("/repo", {});
    expect(result).toBeNull();
  });

  it("filters by directory scope", async () => {
    const result = await resolveScope("/repo", { scope: "src" });

    expect(result).toHaveLength(3);
    expect(result).toContain("src/app.ts");
    expect(result).toContain("src/utils/helpers.ts");
    expect(result).toContain("src/api/routes.ts");
  });

  it("filters by multiple directories", async () => {
    const result = await resolveScope("/repo", { scope: "src,lib" });

    expect(result).toHaveLength(5);
    expect(result).toContain("src/app.ts");
    expect(result).toContain("lib/core.js");
  });

  it("filters by file pattern", async () => {
    const result = await resolveScope("/repo", { files: "*.ts" });

    expect(result).toHaveLength(4);
    expect(result).toContain("src/app.ts");
    expect(result).toContain("tests/app.test.ts");
    expect(result).not.toContain("lib/core.js");
  });

  it("combines scope and files filters", async () => {
    const result = await resolveScope("/repo", { scope: "src", files: "*.ts" });

    expect(result).toHaveLength(3);
    expect(result).toContain("src/app.ts");
    expect(result).not.toContain("tests/app.test.ts");
    expect(result).not.toContain("lib/core.js");
  });

  it("filters by multiple file patterns", async () => {
    const result = await resolveScope("/repo", { files: "*.ts,*.js" });

    expect(result).toHaveLength(6);
  });

  it("handles trailing slash in scope", async () => {
    const result = await resolveScope("/repo", { scope: "src/" });

    expect(result).toHaveLength(3);
    expect(result).toContain("src/app.ts");
  });

  it("returns empty array when nothing matches", async () => {
    const result = await resolveScope("/repo", { scope: "nonexistent" });

    expect(result).toEqual([]);
  });
});

describe("buildFileManifest", () => {
  it("builds a manifest string", () => {
    const manifest = buildFileManifest(["src/app.ts", "src/utils.ts"]);

    expect(manifest).toContain("Files to review (2 total):");
    expect(manifest).toContain("src/app.ts");
    expect(manifest).toContain("src/utils.ts");
  });

  it("truncates at 200 files", () => {
    const files = Array.from({ length: 250 }, (_, i) => `file${i}.ts`);
    const manifest = buildFileManifest(files);

    expect(manifest).toContain("250 total");
    expect(manifest).toContain("and 50 more files");
  });

  it("handles empty file list", () => {
    const manifest = buildFileManifest([]);
    expect(manifest).toContain("No files match");
  });
});
