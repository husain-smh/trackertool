/**
 * Structured logging utility
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

interface LogContext {
  tweetId?: string;
  operation?: string;
  requestId?: string;
  [key: string]: any;
}

class Logger {
  private requestId?: string;

  setRequestId(requestId: string) {
    this.requestId = requestId;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? JSON.stringify(context) : '';
    const requestIdStr = this.requestId ? `[${this.requestId}]` : '';
    
    return `[${timestamp}] ${level.toUpperCase()} ${requestIdStr} ${message} ${contextStr}`;
  }

  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.formatMessage(LogLevel.DEBUG, message, context));
    }
  }

  info(message: string, context?: LogContext) {
    console.log(this.formatMessage(LogLevel.INFO, message, context));
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatMessage(LogLevel.WARN, message, context));
  }

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorContext = {
      ...context,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : String(error),
    };
    console.error(this.formatMessage(LogLevel.ERROR, message, errorContext));
  }
}

export const logger = new Logger();

