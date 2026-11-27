import type { ComponentVersion } from '../../shared/install-components';
import { componentSegment } from '../../shared/install-components';
export function parseLiteLoader(value: unknown, minecraft: string): ComponentVersion[] { if (value === null)
    return []; const rows = Array.isArray(value) ? value : [value]; if (rows.length > 1000)
    throw Error('无效 LiteLoader 清单'); return rows.map(x => { const b = x?.build; if (x?.mcversion !== minecraft || !b || b.tweakClass !== 'com.mumfrey.liteloader.launch.LiteLoaderTweaker' || !/^([a-f0-9]{32})$/i.test(b.md5))
    throw Error('无效 LiteLoader 元数据'); const version = componentSegment(b.version); if (!Array.isArray(b.libraries) || b.libraries.length > 100 || b.libraries.some((l: any) => !l || typeof l.name !== 'string' || !/^([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.+-]+)$/.test(l.name)))
    throw Error('无效LiteLoader依赖'); return { kind: 'liteloader', minecraft, id: version, filename: `liteloader-${version}.jar`, url: `https://bmclapi2.bangbang93.com/maven/com/mumfrey/liteloader/${version}/liteloader-${version}.jar`, stable: x.type === 'RELEASE', md5: b.md5.toLowerCase(), libraries: b.libraries.map((l: any) => l.name) }; }); }
