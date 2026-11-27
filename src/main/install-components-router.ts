import type { CommandRouter } from './ipc';
import { validateComponentQuery, validateComponentSelection, validateInstallerSave, validatePromotionQuery } from '../shared/install-components';
import type { InstallComponentService } from './services/install-components';
export function registerInstallComponentCommands(router: CommandRouter, service: InstallComponentService, choosePath:(query:import('../shared/install-components').InstallerSaveQuery)=>Promise<string|null>): void {
    router.register('installers.save', validateInstallerSave, async q => {
        const path=await choosePath(q);if(!path)return null;
        return {taskId:service.saveInstaller(q,path),path};
    });
    router.register('forge.promotions', validatePromotionQuery, q => service.forgePromotions(q.minecraft));
    router.register('components.versions', validateComponentQuery, q => service.versions(q));
    router.register('components.save', v => validateComponentSelection(v), async (q) => service.save(q));
    router.register('components.install', v => { const q = validateComponentSelection(v, true); return { ...q, instanceId: q.instanceId! }; }, async (q) => service.install(q));
}
