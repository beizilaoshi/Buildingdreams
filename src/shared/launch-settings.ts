export interface LaunchSettings {
    width: number;
    height: number;
    fullscreen: boolean;
    serverHost: string;
    serverPort: number;
    gameArgs: string[];
    gc: 'auto' | 'g1' | 'zgc';
    windowTitle: string;
    versionInfo: string;
    preCommandEnabled: boolean;
    preCommand: string;
    preCommandWait: boolean;
    preCommandTimeout: number;
    launcherAction: 'keep' | 'hide' | 'minimize';
    restoreLauncher: boolean;
    priority: 'normal' | 'belowNormal' | 'aboveNormal';
    gpu: 'system';
}
export const DEFAULT_LAUNCH: Readonly<LaunchSettings> = Object.freeze({ width: 854, height: 480, fullscreen: false, serverHost: '', serverPort: 25565, gameArgs: [], gc: 'auto', windowTitle: '', versionInfo: '', preCommandEnabled: false, preCommand: '', preCommandWait: true, preCommandTimeout: 30, launcherAction: 'keep', restoreLauncher: true, priority: 'normal', gpu: 'system' });
const enums: Record<string, readonly string[]> = { gc: ['auto', 'g1', 'zgc'], launcherAction: ['keep', 'hide', 'minimize'], priority: ['normal', 'belowNormal', 'aboveNormal'], gpu: ['system'] };
const ranges: Record<string, number[]> = { width: [320, 16384], height: [240, 16384], serverPort: [1, 65535], preCommandTimeout: [1, 300] };
export function validateGameArguments(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 128 || value.some(v => typeof v !== 'string' || v.length > 4096 || /[\0\r\n]/.test(v)))
        throw Error('无效游戏参数（每行一个参数）');
    if (value.some(v => /^--?(?:accessToken|username|uuid|userType|userProperties|profileProperties|clientId|xuid|gameDir|assetsDir|assetIndex|version|versionType|width|height|fullscreen|server|port|quickPlay\w*)(?:=|$)/i.test(v)))
        throw Error('游戏参数不能覆盖账号、路径或托管启动选项');
    return [...value];
}
export function validateLaunchSettings(input: unknown): Partial<LaunchSettings> {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype)
        throw Error('启动设置必须为对象');
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (!Object.hasOwn(DEFAULT_LAUNCH, key))
            throw Error('未知启动设置');
        if (key === 'gameArgs') {
            result[key] = validateGameArguments(value);
            continue;
        }
        if (enums[key]) {
            if (typeof value !== 'string' || !enums[key].includes(value))
                throw Error('无效启动选项');
        }
        else if (ranges[key]) {
            const [min, max] = ranges[key];
            if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
                throw Error('启动数值超出范围');
        }
        else if (typeof value !== typeof DEFAULT_LAUNCH[key as keyof LaunchSettings])
            throw Error('无效启动设置类型');
        if (typeof value === 'string' && (value.length > (key === 'preCommand' ? 4096 : 256) || value.includes('\0') || (key !== 'preCommand' && /[\r\n]/.test(value))))
            throw Error('启动文本过长或包含控制字符');
        if (key === 'serverHost' && value !== '') {
            const host = String(value);
            let valid = false;
            if (host.includes(':')) {
                try {
                    valid = new URL('http://[' + host + ']/').hostname.length > 2;
                }
                catch { }
            }
            else
                valid = host.length <= 253 && host.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
            if (/^\d+\.\d+\.\d+\.\d+$/.test(host))
                valid = host.split('.').every(n => Number(n) <= 255);
            if (!valid)
                throw Error('服务器必须为主机名或 IP');
        }
        result[key] = value;
    }
    return result as Partial<LaunchSettings>;
}
export function effectiveLaunchSettings(global?: Partial<LaunchSettings>, override?: Partial<LaunchSettings>): LaunchSettings {
    return { ...structuredClone(DEFAULT_LAUNCH), ...validateLaunchSettings(global ?? {}), ...validateLaunchSettings(override ?? {}) };
}
