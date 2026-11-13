import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LaunchService } from '../src/main/services/launch';
it('launch repair downloads modern Mojang client and metadata with verified bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'launch-modern-hosts-'));
    const bytes = Buffer.from('verified modern repair fixture');
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { fetched.push(url); return new Response(bytes); });
    try {
        const service = new LaunchService({} as any, {} as any, async () => ({ name: 'test', uuid: 'uuid', accessToken: 'token' }));
        for (const [i, host] of ['piston-data.mojang.com', 'piston-meta.mojang.com'].entries()) {
            await (service as any).download(root, { url: `https://${host}/fixture`, path: `file-${i}`, sha1: createHash('sha1').update(bytes).digest('hex') }, new AbortController().signal);
            expect(await readFile(join(root, `file-${i}`))).toEqual(bytes);
        }
        expect(fetched).toEqual(['https://piston-data.mojang.com/fixture', 'https://piston-meta.mojang.com/fixture']);
        await expect((service as any).download(root, { url: 'https://piston-data.mojang.com.evil.test/fixture', path: 'bad', sha1: 'a'.repeat(40) }, new AbortController().signal)).rejects.toThrow('非官方');
        expect(fetched).toHaveLength(2);
    }
    finally {
        vi.unstubAllGlobals();
        await rm(root, { recursive: true, force: true });
    }
});
it.each([false, true])('launch repair fetches client and libraries with missingIndex=%s', async (missingIndex) => {
    const { fixture } = await import('./minecraft-fixture');
    const { Version } = await import('@xmcl/core');
    const { writeFile, mkdir } = await import('node:fs/promises');
    const root = await fixture();
    const profilePath = join(root, 'versions', 'base', 'base.json');
    const profile = JSON.parse(await readFile(profilePath, 'utf8'));
    const client = Buffer.from('client'), library = Buffer.from('library'), index = Buffer.from(JSON.stringify({ objects: {} }));
    const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
    profile.assets = 'fixture';
    profile.assetIndex = { id: 'fixture', url: 'https://piston-meta.mojang.com/index', sha1: sha(index), size: index.length };
    profile.downloads = { client: { url: 'https://piston-data.mojang.com/client', sha1: sha(client), size: client.length } };
    profile.libraries = [{ name: 'test:library:1', downloads: { artifact: { path: 'test/library/1/library-1.jar', url: 'https://libraries.minecraft.net/library', sha1: sha(library), size: library.length } } }];
    await writeFile(profilePath, JSON.stringify(profile));
    await mkdir(join(root, 'assets', 'indexes'), { recursive: true });
    if (!missingIndex)
        await writeFile(join(root, 'assets', 'indexes', 'fixture.json'), index);
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { fetched.push(url); return new Response(url.endsWith('/client') ? client : url.endsWith('/library') ? library : index); });
    try {
        const service = new LaunchService({} as any, {} as any, async () => ({ name: 'test', uuid: 'uuid', accessToken: 'token' }));
        const version = await Version.parse(root, 'base');
        const missing = [join(root, 'versions', 'base', 'base.jar'), join(root, 'libraries', 'test', 'library', '1', 'library-1.jar'), ...(missingIndex ? [join(root, 'assets', 'indexes', 'fixture.json')] : [])];
        await (service as any).repair({ resourceDir: root, versionId: 'base' }, version, missing, new AbortController().signal);
        expect(await readFile(join(root, 'versions', 'base', 'base.jar'))).toEqual(client);
        expect(await readFile(join(root, 'libraries', 'test', 'library', '1', 'library-1.jar'))).toEqual(library);
        expect(fetched).toContain('https://piston-data.mojang.com/client');
        expect(fetched).toContain('https://libraries.minecraft.net/library');
        expect(fetched.includes('https://piston-meta.mojang.com/index')).toBe(missingIndex);
    }
    finally {
        vi.unstubAllGlobals();
        await rm(root, { recursive: true, force: true });
    }
});
