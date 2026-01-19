/**
 * 前端日志模块
 * 提供统一的日志输出格式，便于调试和问题排查
 */

const LOG_PREFIX = "[GMM]";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, message: string): string {
  return `${LOG_PREFIX} ${formatTimestamp()} [${level}] ${message}`;
}

function formatData(data: unknown): string {
  if (data === undefined || data === null) {
    return "";
  }
  try {
    if (typeof data === "object") {
      return JSON.stringify(data, null, 2);
    }
    return String(data);
  } catch {
    return "[无法序列化的数据]";
  }
}

export const logger = {
  /**
   * 调试级别日志 - 用于开发时的详细信息
   */
  debug: (message: string, data?: unknown) => {
    if (import.meta.env.DEV) {
      const formatted = formatMessage("DEBUG", message);
      if (data !== undefined) {
        console.debug(formatted, data);
      } else {
        console.debug(formatted);
      }
    }
  },

  /**
   * 信息级别日志 - 用于一般性操作记录
   */
  info: (message: string, data?: unknown) => {
    const formatted = formatMessage("INFO", message);
    if (data !== undefined) {
      console.log(formatted, data);
    } else {
      console.log(formatted);
    }
  },

  /**
   * 警告级别日志 - 用于潜在问题
   */
  warn: (message: string, data?: unknown) => {
    const formatted = formatMessage("WARN", message);
    if (data !== undefined) {
      console.warn(formatted, data);
    } else {
      console.warn(formatted);
    }
  },

  /**
   * 错误级别日志 - 用于错误和异常
   */
  error: (message: string, data?: unknown) => {
    const formatted = formatMessage("ERROR", message);
    if (data !== undefined) {
      console.error(formatted, data);
    } else {
      console.error(formatted);
    }
  },

  /**
   * 分组日志 - 用于将相关日志归组
   */
  group: (label: string) => {
    console.group(`${LOG_PREFIX} ${label}`);
  },

  /**
   * 结束分组
   */
  groupEnd: () => {
    console.groupEnd();
  },

  /**
   * 折叠的分组日志
   */
  groupCollapsed: (label: string) => {
    console.groupCollapsed(`${LOG_PREFIX} ${label}`);
  },

  /**
   * 表格形式输出数据
   */
  table: (data: unknown) => {
    console.table(data);
  },
};

export default logger;
