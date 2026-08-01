type LogLevel = "debug" | "info" | "warn" | "error";

type LogPayload = {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
};

function write(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const payload: LogPayload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    write("debug", message, context);
  },
  info(message: string, context?: Record<string, unknown>) {
    write("info", message, context);
  },
  warn(message: string, context?: Record<string, unknown>) {
    write("warn", message, context);
  },
  error(message: string, context?: Record<string, unknown>) {
    write("error", message, context);
  }
};
