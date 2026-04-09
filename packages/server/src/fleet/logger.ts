/**
 * Fleet Logger — structured logging for fleet infrastructure modules.
 *
 * Provides consistent format across nats-bridge, health-monitor, file-lock, and dispatcher.
 * Logs with timestamp, level, component tag, and message.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const minLevel: LogLevel = (process.env.FLEET_LOG_LEVEL as LogLevel) ?? 'info';

export class FleetLogger {
  constructor(private component: string) {}

  debug(msg: string, ...args: unknown[]): void {
    this.log('debug', msg, ...args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.log('info', msg, ...args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.log('warn', msg, ...args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.log('error', msg, ...args);
  }

  private log(level: LogLevel, msg: string, ...args: unknown[]): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

    const ts = new Date().toISOString();
    const prefix = `${ts} [${level.toUpperCase().padEnd(5)}] [${this.component}]`;

    if (args.length > 0) {
      const extras = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`${prefix} ${msg} ${extras}`);
    } else {
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`${prefix} ${msg}`);
    }
  }
}

/** Create a logger for a fleet component */
export function createFleetLogger(component: string): FleetLogger {
  return new FleetLogger(component);
}
