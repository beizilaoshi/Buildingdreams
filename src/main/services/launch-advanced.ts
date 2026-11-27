import type { LaunchSettings } from '../../shared/launch-settings';
export interface MemoryEnvironment { totalMb: number; freeMb: number; arch: string; minecraft: string; modded: boolean; }
/** Leave physical and currently free memory for the OS; never exceed a 32-bit JVM's safe heap. */
export function automaticMemory(machine: MemoryEnvironment): number {
    if (![machine.totalMb, machine.freeMb].every(Number.isFinite) || machine.totalMb < 1024 || machine.freeMb < 512) throw Error('可用内存不足 512 MB');
    const modern = Number(/^1\.(\d+)/.exec(machine.minecraft)?.[1] ?? 21) >= 18;
    const desired = machine.modded ? 6144 : modern ? 4096 : 2048;
    const architectureLimit = ['amd64', 'x86_64', 'aarch64', 'arm64'].includes(machine.arch) ? 16384 : 1024;
    const available = Math.max(512, Math.min(machine.totalMb - 1024, machine.freeMb - 512));
    return Math.floor(Math.min(desired, architectureLimit, available) / 256) * 256;
}
export function launchMemory(instanceMb: number, preferences: LaunchSettings, machine: MemoryEnvironment, globalMb = 4096): number {
    const result = preferences.memoryMode === 'auto' ? automaticMemory(machine) : preferences.memoryMode === 'global' ? globalMb : instanceMb;
    if (!Number.isInteger(result) || result < 512 || result > machine.totalMb) throw Error('实例内存超过可用物理内存或小于 512 MB');
    if (!['amd64', 'x86_64', 'aarch64', 'arm64'].includes(machine.arch) && result > 1024) throw Error('32 位 Java 内存不能超过 1024 MB，请选择 64 位 Java 或自动内存');
    return result;
}
/** Java selection must leave an x86 candidate eligible until its actual architecture is known. */
export function javaSelectionMemory(memoryMb: number, preferences: LaunchSettings): number {
    return preferences.memoryMode === 'auto' ? Math.min(memoryMb, 1024) : memoryMb;
}
export function renderWindowTitle(template: string, context: { player: string; version: string; instance: string }): string {
    const values = { ...context, launcher: '筑梦启动器' };
    return template.replace(/\{(player|version|instance|launcher)\}/g, (_, key: keyof typeof values) => values[key]).replace(/[\0-\x1f\x7f]/g, '').slice(0, 256);
}
export function launcherLifecycleAction(action: LaunchSettings['launcherAction'], event: 'ready' | 'end', owned: boolean, ready: boolean): 'exit' | 'hide' | 'minimize' | undefined {
    if (!owned || !ready) return;
    if ((action === 'exitOnGameEnd' && event === 'end')) return 'exit';
    if (event === 'ready' && (action === 'hide' || action === 'minimize')) return action;
}
