import { config } from './config.js';
const LEVEL_COLORS = {
    debug: '\x1b[90m',
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
};
const RESET = '\x1b[0m';
function log(level, message, data) {
    const ts = new Date().toISOString();
    const color = LEVEL_COLORS[level];
    const prefix = `${color}[${ts}] [${config.agentId}] [${level.toUpperCase()}]${RESET}`;
    if (data !== undefined) {
        console.log(`${prefix} ${message}`, data);
    }
    else {
        console.log(`${prefix} ${message}`);
    }
}
export const logger = {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
};
//# sourceMappingURL=logger.js.map