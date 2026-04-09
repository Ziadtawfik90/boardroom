import { config } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

const RESET = '\x1b[0m';

function log(level: Level, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const color = LEVEL_COLORS[level];
  const prefix = `${color}[${ts}] [${config.agentId}] [${level.toUpperCase()}]${RESET}`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
};
