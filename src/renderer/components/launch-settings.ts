import { choice, type ChoiceControl } from "./choice";
import { effectiveLaunchSettings, type LaunchSettings } from '../../shared/launch-settings';
import { api, state, selected, e, button, panel, field, input, notify } from '../ui';
export function launchSettingsCard(instanceId?: string): HTMLElement {
    const card = panel('启动选项', instanceId ? '这些设置只作用于当前版本；勾选“单独设置”可覆盖全局值，取消勾选恢复继承。自动内存每次启动按当前空闲内存计算。' : '全局选项供所有继承的游戏使用。勾选“单独设置”可覆盖当前游戏；取消勾选恢复继承。自动内存每次启动按当前空闲内存计算；全局内存值使用“Java 与内存”卡片中的数值。');
    const scope = choice([['instance','当前游戏'],['global','全局启动选项']], selected() ? 'instance' : 'global');
    if (!instanceId) card.append(field('启动选项范围', scope));
    const body = e('div', 'settings-grid');
    card.append(body);
    const labels: Record<keyof LaunchSettings, string> = { memoryMode: '内存分配方式', width: '窗口宽度', height: '窗口高度', fullscreen: '全屏启动', serverHost: '自动进入服务器（主机名或 IP）', serverPort: '服务器端口', gameArgs: '额外游戏参数（每行一个参数）', gc: '垃圾回收器', windowTitle: '游戏窗口标题（Windows）', versionInfo: '自定义版本信息', preCommandEnabled: '启用本地启动前命令', preCommand: '本地启动前命令', preCommandWait: '等待命令结束', preCommandTimeout: '命令超时（秒）', launcherAction: '启动后启动器行为', restoreLauncher: '游戏结束后恢复启动器', priority: '游戏进程优先级（Windows）', gpu: '显卡路由', language: '游戏语言' };
    const options: Partial<Record<keyof LaunchSettings, [
        string,
        string
    ][]>> = { memoryMode: [['fixed', '实例原有固定内存'], ['auto', '自动分配（每次启动重新计算）'], ['global', '使用全局内存值']], gc: [['auto', 'Java 默认'], ['g1', 'G1（Java 8+）'], ['zgc', 'ZGC（64 位 Java 17+）']], launcherAction: [['keep', '保持窗口'], ['hide', '隐藏窗口'], ['minimize', '最小化'], ['exitOnGameEnd', '游戏结束后退出启动器']], priority: [['normal', '正常'], ['belowNormal', '低于正常'], ['aboveNormal', '高于正常']], gpu: [['system', '由 Windows 图形设置决定（未强制显卡）']], language: [['system','跟随游戏默认'],['zh_CN','简体中文'],['en_US','英语'],['zh_TW','繁體中文'],['ja_JP','日本語'],['ko_KR','한국어'],['fr_FR','Français'],['de_DE','Deutsch'],['es_ES','Español'],['pt_BR','Português (Brasil)'],['ru_RU','Русский']] };
    let collect = () => ({} as Partial<LaunchSettings>);
    const render = () => {
        body.replaceChildren();
        const item = instanceId ? state.instances.find(x=>x.id===instanceId) : selected();
        const local = Boolean(instanceId) || scope.value === 'instance' && !!item;
        const effective = effectiveLaunchSettings(state.settings.launch, local && item ? item.launch : undefined);
        const readers: (() => [
            keyof LaunchSettings,
            unknown
        ] | undefined)[] = [];
        for (const key of Object.keys(labels) as (keyof LaunchSettings)[]) {
            const value = effective[key];
            let control: HTMLInputElement | HTMLTextAreaElement | ChoiceControl;
            if (options[key]) {
                control = choice(options[key]!,String(value));
            }
            else if (key === 'preCommand' || key === 'gameArgs') {
                control = document.createElement('textarea');
                control.value = Array.isArray(value) ? value.join('\n') : String(value);
                control.rows = 3;
            }
            else {
                control = input();
                control.type = typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text';
                if (typeof value === 'boolean')
                    control.checked = value;
                else
                    control.value = String(value);
            }
            const wrapper = field(labels[key], control);
            let override: HTMLInputElement | undefined;
            if (local) {
                override = document.createElement('input');
                override.type = 'checkbox';
                override.checked = Object.hasOwn(item?.launch ?? {}, key);
                override.setAttribute('aria-label', labels[key] + ' 单独设置');
                const label = e('label', 'muted');
                label.append(override, document.createTextNode(' 单独设置'));
                wrapper.append(label);
                control.disabled = !override.checked;
                override.onchange = () => { control.disabled = !override!.checked; };
            }
            readers.push(() => { if (override && !override.checked)
                return; return [key, typeof value === 'boolean' ? (control as HTMLInputElement).checked : typeof value === 'number' ? Number(control.value) : key === 'gameArgs' ? control.value.split(/\r?\n/).filter(x => x.length) : control.value]; });
            body.append(wrapper);
        }
        collect = () => Object.fromEntries(readers.map(read => read()).filter(x => x !== undefined)) as Partial<LaunchSettings>;
    };
    if (!instanceId) scope.onchange = render;
    render();
    card.append(e('p', 'muted', '启动前命令仅在本机明确启用后运行；取消不能撤销命令副作用。标题可用 {player}、{version}、{instance}、{launcher}；占位符按文字替换。退出策略只在游戏确认就绪后生效。窗口辅助功能可能因权限或游戏窗口类型不可用。关闭启动器会取消准备与辅助程序，已运行的游戏继续运行。显卡由系统设置管理，本程序不会修改显卡注册表。'), button('保存启动选项', async () => {
        const target = instanceId ? state.instances.find(x=>x.id===instanceId) : selected();
        if ((instanceId || scope.value === 'instance') && target) {
            const item = await api('instances.launchSettings', { id: target.id, launch: collect() });
            state.instances = state.instances.map(x => x.id === item.id ? item : x);
        }
        else
            state.settings = await api('settings.patch', { launch: effectiveLaunchSettings(collect()) });
        notify('启动选项已保存');
    }, 'primary'));
    return card;
}
