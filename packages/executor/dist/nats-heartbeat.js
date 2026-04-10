/**
 * NATS Heartbeat — publishes system metrics to fleet.heartbeat.{nodeId} every 5s.
 *
 * Adapted from fleet-command/daemon/src/heartbeat.ts
 */
import { execSync } from 'node:child_process';
import * as os from 'node:os';
import { FLEET_SUBJECTS, FLEET_HEARTBEAT_INTERVAL_MS } from '@boardroom/shared';
const IS_WINDOWS = os.platform() === 'win32';
function getSystemMetrics() {
    let cpuPercent = 0;
    let memPercent = 0;
    try {
        if (IS_WINDOWS) {
            const cpuOut = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"', { encoding: 'utf-8', timeout: 5000 });
            cpuPercent = parseFloat(cpuOut.trim()) || 0;
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            memPercent = ((totalMem - freeMem) / totalMem) * 100;
        }
        else {
            const loadAvg = parseFloat(execSync('cat /proc/loadavg', { encoding: 'utf-8' }).split(' ')[0]);
            const cpuCount = os.cpus().length;
            cpuPercent = Math.min(100, (loadAvg / cpuCount) * 100);
            const memInfo = execSync('free -b', { encoding: 'utf-8' });
            const memLine = memInfo.split('\n')[1].split(/\s+/);
            const total = parseInt(memLine[1], 10);
            const used = parseInt(memLine[2], 10);
            memPercent = (used / total) * 100;
        }
    }
    catch {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        memPercent = ((totalMem - freeMem) / totalMem) * 100;
        cpuPercent = (os.loadavg()[0] / os.cpus().length) * 100;
    }
    // GPU metrics via nvidia-smi
    let gpuPercent;
    let gpuMemPercent;
    const nvCmds = IS_WINDOWS
        ? ['"C:\\Windows\\System32\\nvidia-smi.exe" --query-gpu=utilization.gpu,utilization.memory --format=csv,noheader,nounits']
        : [
            'nvidia-smi --query-gpu=utilization.gpu,utilization.memory --format=csv,noheader,nounits',
            '/mnt/c/Windows/System32/nvidia-smi.exe --query-gpu=utilization.gpu,utilization.memory --format=csv,noheader,nounits',
        ];
    for (const cmd of nvCmds) {
        try {
            const nvOut = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
            const [gpu, gpuMem] = nvOut.trim().split(',').map((s) => parseFloat(s.trim()));
            gpuPercent = gpu;
            gpuMemPercent = gpuMem;
            break;
        }
        catch {
            continue;
        }
    }
    return { cpuPercent, memPercent, gpuPercent, gpuMemPercent };
}
export function startNatsHeartbeat(nc, nodeId, getActiveTasks, version = '1.0.0') {
    const startTime = Date.now();
    const send = () => {
        const metrics = getSystemMetrics();
        const hb = {
            type: 'heartbeat',
            nodeId,
            state: 'alive',
            activeTasks: getActiveTasks(),
            cpuPercent: Math.round(metrics.cpuPercent * 10) / 10,
            memPercent: Math.round(metrics.memPercent * 10) / 10,
            gpuPercent: metrics.gpuPercent,
            gpuMemPercent: metrics.gpuMemPercent,
            uptime: Math.floor((Date.now() - startTime) / 1000),
            version,
            timestamp: new Date().toISOString(),
        };
        nc.publish(FLEET_SUBJECTS.heartbeat(nodeId), new TextEncoder().encode(JSON.stringify(hb)));
    };
    send();
    return setInterval(send, FLEET_HEARTBEAT_INTERVAL_MS);
}
//# sourceMappingURL=nats-heartbeat.js.map