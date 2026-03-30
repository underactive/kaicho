import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFixWorktree, createSweepWorktree, removeFixWorktree, pruneStaleWorktrees } from "./worktree.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { execa } from "execa";

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
  mockExeca.mockImplementation((() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })) as unknown as typeof execa);
});

describe("pruneStaleWorktrees", () => {
  it("runs git worktree prune", async () => {
    await pruneStaleWorktrees("/repo");
    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["worktree", "prune"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });
});

describe("createFixWorktree", () => {
  it("creates a worktree with a new branch at HEAD", async () => {
    const result = await createFixWorktree("/repo");

    expect(result.branch).toMatch(/^kaicho\/fix-[0-9a-f]{8}$/);
    expect(result.worktreePath).toContain("kaicho-wt-");

    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "-b", result.branch, result.worktreePath, "HEAD"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });
});

describe("createSweepWorktree", () => {
  it("creates a worktree with a sweep branch at HEAD", async () => {
    const result = await createSweepWorktree("/repo");

    expect(result.branch).toMatch(/^kaicho\/sweep-[0-9a-f]{8}$/);
    expect(result.worktreePath).toContain("kaicho-sweep-");

    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "-b", result.branch, result.worktreePath, "HEAD"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });
});

describe("removeFixWorktree", () => {
  it("removes worktree and deletes branch when deleteBranch is true", async () => {
    await removeFixWorktree("/repo", "/tmp/wt", "kaicho/fix-abc123", true);

    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "/tmp/wt", "--force"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["branch", "-D", "kaicho/fix-abc123"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("removes worktree but keeps branch when deleteBranch is false", async () => {
    await removeFixWorktree("/repo", "/tmp/wt", "kaicho/fix-abc123", false);

    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "/tmp/wt", "--force"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(mockExeca).not.toHaveBeenCalledWith(
      "git",
      ["branch", "-D", "kaicho/fix-abc123"],
      expect.anything(),
    );
  });
});
