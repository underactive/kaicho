import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureCleanWorkTree, getCurrentBranch } from "./manager.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";

const mockExeca = vi.mocked(execa);

function mockExecaImpl(fn: (command: string, args?: string[]) => unknown): void {
  mockExeca.mockImplementation(fn as unknown as typeof execa);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureCleanWorkTree", () => {
  it("succeeds when working tree is clean", async () => {
    mockExecaImpl(() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }));
    await expect(ensureCleanWorkTree("/repo")).resolves.toBeUndefined();
  });

  it("throws when working tree has changes", async () => {
    mockExecaImpl(() =>
      Promise.resolve({ exitCode: 0, stdout: " M src/app.ts\n?? new-file.ts", stderr: "" }),
    );
    await expect(ensureCleanWorkTree("/repo")).rejects.toThrow(
      "uncommitted changes",
    );
  });
});

describe("getCurrentBranch", () => {
  it("returns the current branch name", async () => {
    mockExecaImpl(() => Promise.resolve({ exitCode: 0, stdout: "main\n", stderr: "" }));
    const branch = await getCurrentBranch("/repo");
    expect(branch).toBe("main");
  });
});
