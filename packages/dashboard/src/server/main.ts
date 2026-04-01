import { startServer } from "./index.js";

const repoPath = process.argv[2] || process.cwd();
const port = parseInt(process.env["PORT"] || "3456", 10);

await startServer({ repoPath, port, open: false });
