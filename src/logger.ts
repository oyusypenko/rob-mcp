export type LogLevel = "debug" | "info" | "warn" | "error";

const ranks: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(
  minimumLevel: LogLevel,
  write: (line: string) => void = (line) => console.error(line),
  now: () => Date = () => new Date(),
): Logger {
  const log = (level: LogLevel, message: string, context: Record<string, unknown> = {}): void => {
    if (ranks[level] < ranks[minimumLevel]) {
      return;
    }
    write(
      JSON.stringify({
        timestamp: now().toISOString(),
        level,
        message,
        ...context,
      }),
    );
  };

  return {
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
  };
}
