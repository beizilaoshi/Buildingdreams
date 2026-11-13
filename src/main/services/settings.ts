import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../../shared/settings';
import type { Settings } from '../../shared/types';
export interface SettingsFileSystem {
  mkdir: typeof mkdir; open: typeof open; readFile: typeof readFile; rename: typeof rename; rm: typeof rm;
}
const filesystem: SettingsFileSystem = { mkdir, open, readFile, rename, rm };

export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string, private readonly io: SettingsFileSystem = filesystem) {}
  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(job);
    this.queue = result.catch(() => undefined);
    return result;
  }
  read(): Promise<Settings> { return this.serialize(() => this.load()); }
  patch(patch: Partial<Settings>): Promise<Settings> {
    return this.serialize(async () => {
      const valid = validateSettingsPatch(patch, true);
      const next = { ...await this.load(), ...valid };
      await this.write(next);
      return structuredClone(next);
    });
  }
  reset(): Promise<Settings> {
    return this.serialize(async () => { const settings = structuredClone(DEFAULT_SETTINGS); await this.write(settings); return settings; });
  }
  private async load(): Promise<Settings> {
    let text: string;
    try { text = await this.io.readFile(this.path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const defaults = structuredClone(DEFAULT_SETTINGS); await this.write(defaults); return defaults;
    }
    try { return { ...structuredClone(DEFAULT_SETTINGS), ...validateSettingsPatch(JSON.parse(text), true) }; }
    catch {
      await this.io.rename(this.path, `${this.path}.corrupt-${Date.now()}-${randomUUID()}`);
      const defaults = structuredClone(DEFAULT_SETTINGS); await this.write(defaults); return defaults;
    }
  }
  private async write(settings: Settings): Promise<void> {
    await this.io.mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const handle = await this.io.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(settings, null, 2), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await this.io.rename(temporary, this.path);
    } finally { await this.io.rm(temporary, { force: true }); }
  }
}
