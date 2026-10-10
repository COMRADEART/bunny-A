import { readFileSync } from "node:fs";
import { execOwnedFile } from "../bunny-host/owned-processes.server.ts";
import { cpus, freemem, totalmem } from "node:os";
import type { GpuSample, HostSample } from "./types";
import { pathTool, systemTool } from "../bunny-host/system-tools.server.ts";

const execFileAsync = execOwnedFile;

type CpuTick = { idle: number; total: number };
let previous: CpuTick | null = null;

function cpuTick(): CpuTick {
  return cpus().reduce((tick, cpu) => ({
    idle: tick.idle + cpu.times.idle,
    total: tick.total + Object.values(cpu.times).reduce((sum, value) => sum + value, 0),
  }), { idle: 0, total: 0 });
}

function clockMhz(): number | null {
  try {
    const khz = Number(readFileSync("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq", "utf8").trim());
    if (!Number.isFinite(khz) || khz <= 0) return null;
    return Math.round(khz / 1000);
  } catch {
    const speeds = cpus().map((cpu) => cpu.speed).filter((speed) => speed > 0);
    return speeds.length ? Math.round(speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length) : null;
  }
}

/** Linux MemAvailable counts reclaimable cache as free; os.freemem() (MemFree) does not and overstates pressure. */
function linuxAvailableBytes(): number | null {
  try {
    const match = /^MemAvailable:\s+(\d+)\s*kB/m.exec(readFileSync("/proc/meminfo", "utf8"));
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
}

function memory() {
  const totalBytes = totalmem();
  const availableBytes = Math.min(totalBytes, process.platform === "linux" ? linuxAvailableBytes() ?? freemem() : freemem());
  return { totalBytes, availableBytes, usedBytes: Math.max(0, totalBytes - availableBytes) };
}

export function parseNvidiaSamples(stdout: string): GpuSample[] {
  return stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>{
    const [name,util,used,total,temp,power]=line.split(",").map(part=>part.trim());
    const num=(value:string|undefined)=>{if(!value || /n\/a|not supported/i.test(value)) return null;const n=Number(value);return Number.isFinite(n) ? n : null;};
    return {name:name || "NVIDIA GPU",utilization:num(util),memoryUsedBytes:num(used)==null ? null : num(used)!*1024*1024,memoryTotalBytes:num(total)==null ? null : num(total)!*1024*1024,temperatureC:num(temp),powerW:num(power),note:null};
  });
}
let windowsGpuNames: string[] | null=null;
async function detectedWindowsGpus(): Promise<string[]> {
  if(process.platform!=="win32") return [];
  if(windowsGpuNames) return windowsGpuNames;
  try {
    const {stdout}=await execFileAsync(systemTool("powershell.exe"),["-NoProfile","-Command","Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress"],{timeout:4000,windowsHide:true});
    const values=JSON.parse(stdout);windowsGpuNames=(Array.isArray(values) ? values : [values]).filter((v:unknown):v is string=>typeof v === "string");
  } catch { windowsGpuNames=[]; }
  return windowsGpuNames;
}
async function nvidia(): Promise<GpuSample[]> {
  try {
    const tool = pathTool("nvidia-smi");
    if (!tool) return [];
    const { stdout } = await execFileAsync(
      tool,
      ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits"],
      { timeout: 1500 },
    );
    return parseNvidiaSamples(stdout);
  } catch {
    return [];
  }
}

export async function sampleHost(): Promise<HostSample> {
  const notes: string[] = [];
  const now = cpuTick();
  let utilization: number | null = null;
  if (previous && now.total > previous.total) {
    const total = now.total - previous.total;
    const idle = now.idle - previous.idle;
    utilization = Math.round((1 - idle / total) * 1000) / 10;
  } else {
    notes.push("CPU utilization appears on the next sample.");
  }
  previous = now;

  const clock = clockMhz();
  if (clock == null) notes.push("CPU clock unavailable");
  notes.push("Temperature unavailable");

  const [gpus,names]=await Promise.all([nvidia(),detectedWindowsGpus()]);
  for(const name of names) if(!gpus.some(gpu=>gpu.name.toLowerCase()===name.toLowerCase())) gpus.push({name,utilization:null,memoryUsedBytes:null,memoryTotalBytes:null,temperatureC:null,powerW:null,note:"GPU detected by Windows; vendor telemetry unavailable."});
  if(!gpus.length) notes.push("GPU telemetry is unavailable on this host.");

  return {
    at: Date.now(),
    cpu: { utilization, clockMhz: clock, temperatureC: null },
    memory: memory(),
    gpus,
    notes,
  };
}
