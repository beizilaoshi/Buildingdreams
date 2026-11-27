export type InstallComponentKind = 'optifine' | 'liteloader';
export interface ComponentQuery {
    kind: InstallComponentKind;
    minecraft: string;
}
export interface ComponentVersion {
    kind: InstallComponentKind;
    minecraft: string;
    id: string;
    filename: string;
    url: string;
    stable: boolean;
    md5?: string;
    libraries?: string[];
    forge?: string;
}
export interface ComponentSelection extends ComponentQuery {
    version: string;
}
export type InstallerSaveKind = 'server' | 'forge' | 'neoforge' | 'fabric' | 'quilt';
export interface InstallerSaveQuery { kind: InstallerSaveKind; minecraft: string; version: string }
export interface InstallComponentCommandMap {
    'installers.save': { payload: InstallerSaveQuery; result: { taskId: string; path: string } | null };
    'forge.promotions': { payload: { minecraft: string }; result: { recommended?: string; latest?: string; changelog: string } };
    'components.versions': {
        payload: ComponentQuery;
        result: ComponentVersion[];
    };
    'components.save': {
        payload: ComponentSelection;
        result: string;
    };
    'components.install': {
        payload: ComponentSelection & {
            instanceId: string;
        };
        result: string;
    };
}
export function componentSegment(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 160 || !/^[a-zA-Z0-9_.+\-]+$/.test(value) || value === '.' || value === '..')
    throw Error('无效组件版本'); return value; }
export function validateComponentQuery(value: unknown): ComponentQuery { const x = record(value, ['kind', 'minecraft']); return query(x); }
function record(value: unknown, keys: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
    throw Error('无效组件参数'); return value as Record<string, unknown>; }
function query(x: Record<string, unknown>): ComponentQuery { if (x.kind !== 'optifine' && x.kind !== 'liteloader')
    throw Error('不支持的安装组件'); return { kind: x.kind, minecraft: componentSegment(x.minecraft) }; }
export function validateComponentSelection(value: unknown, install = false): ComponentSelection & {
    instanceId?: string;
} { const x = record(value, install ? ['kind', 'minecraft', 'version', 'instanceId'] : ['kind', 'minecraft', 'version']); if (typeof x.version !== 'string' || !x.version || x.version.length > 200)
    throw Error('无效组件选择'); return { ...query(x), version: x.version, ...(install ? { instanceId: componentSegment(x.instanceId) } : {}) }; }

export function validateInstallerSave(value: unknown): InstallerSaveQuery { const x = record(value, ['kind', 'minecraft', 'version']); if (!['server', 'forge', 'neoforge', 'fabric', 'quilt'].includes(String(x.kind))) throw Error('不支持的保存类型'); return { kind: x.kind as InstallerSaveKind, minecraft: componentSegment(x.minecraft), version: componentSegment(x.version) }; }
export function validatePromotionQuery(value: unknown): { minecraft: string } { const x = record(value, ['minecraft']); return { minecraft: componentSegment(x.minecraft) }; }
