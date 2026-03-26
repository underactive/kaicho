type LogLevel = "debug" | "info" | "warn" | "error";

export function log(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  });
  process.stderr.write(entry + "\n");
}
