import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Windows installer and uninstaller', () => {
  it('uses the branded interactive Inno Setup wizard and preserves user data', async () => {
    const config = await readFile('build/installer/zhumeng.iss', 'utf8');
    const experience = await readFile('build/installer/experience.iss', 'utf8');
    const artGenerator = await readFile('scripts/build-installer-art.ps1', 'utf8');

    expect(config).toContain('#include "experience.iss"');
    expect(config).toMatch(/DisableWelcomePage=no/);
    expect(config).toMatch(/PrivilegesRequired=lowest/);
    expect(config).toMatch(/UsePreviousAppDir=yes/);
    expect(config).toMatch(/Uninstallable=yes/);
    expect(config).toMatch(/Flags: unchecked/);
    expect(config).toContain('让每一个世界，从梦开始。');
    expect(config).toContain('WizardImageFile=assets\\wizard-light.png');
    expect(config).toContain('Source: "assets\\skin-*.png"; DestDir: "{app}\\setup-art"');
    expect(config).toContain('DestDir: "{app}\\setup-art"');
    expect(experience).toContain("ExtractTemporaryFiles('{app}\\setup-art\\*.png')");
    expect(experience).toContain("SkinFolder:=ExpandConstant('{tmp}')+'\\{app}\\setup-art'");
    expect(experience).toContain('WizardForm.SelectDirPage.Color := Paper');
    expect(experience).toContain('WizardForm.SelectTasksPage.Color := Paper');
    expect(experience).toContain('WizardForm.DirEdit.Color := Card');
    expect(experience).toContain('WizardForm.TasksList.Color := Card');
    expect(experience).toContain("'browse','浏览'");
    expect(artGenerator).toContain("'skin-browse-' + $state + '.png'");
    expect(experience).toContain("'给程序一个位置，给创作一份安心。',12,BannerInk");
    expect(experience).toContain("'入口由你决定，风格留待慢慢挑。',12,BannerInk");
    expect(experience).toContain("Name := 'chat'");
    expect(experience).toContain("{userappdata}\\筑梦启动器");
    expect(experience).toContain('移除程序和快捷方式');
    expect(experience).toContain('ZHUMENG_UNINSTALL_PROGRESS');

    const wizard = await readFile('build/installer/assets/wizard-light.png');
    expect(wizard.subarray(1, 4).toString('ascii')).toBe('PNG');
  });
});
