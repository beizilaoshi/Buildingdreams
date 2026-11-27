import type { ComponentVersion } from '../../shared/install-components';
import { componentSegment } from '../../shared/install-components';
export function parseOptifine(value: unknown, minecraft: string): ComponentVersion[] { if (!Array.isArray(value) || value.length > 10000)
    throw Error('无效 OptiFine 清单'); return value.map(x => { if (!x || x.mcversion !== minecraft)
    throw Error('OptiFine 版本不匹配'); const type = componentSegment(x.type), patch = componentSegment(x.patch); const filename = `${/pre/i.test(patch) ? 'preview_' : ''}OptiFine_${minecraft}_${type}_${patch}.jar`; return { kind: 'optifine', minecraft, id: `${type}:${patch}`, filename, url: `https://bmclapi2.bangbang93.com/optifine/${encodeURIComponent(minecraft)}/${type}/${patch}`, stable: !/pre|alpha|beta/i.test(patch), forge: typeof x.forge === 'string' ? x.forge.slice(0, 100) : undefined }; }); }
