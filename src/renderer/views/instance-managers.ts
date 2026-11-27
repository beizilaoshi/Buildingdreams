import { localMods } from '../components/local-mods';
import { worldBackupsView } from '../components/world-backups';
import { button, e, heading, instancePicker, selected, state, go } from '../ui';

function managerPage(title: string, subtitle: string, content: HTMLElement) {
  const node = e('div', 'instance-manager-page');
  const back = button('← 返回游戏库', () => go('library'), 'quiet manager-back');
  back.setAttribute('aria-label', '返回游戏库');
  node.append(back, heading(title, subtitle));
  if (!state.instances.length) {
    const empty = e('section', 'glass empty');
    empty.append(e('h2', '', '还没有游戏实例'), e('p', 'muted', '先安装或导入游戏，再管理它的本地内容。'), button('前往下载', () => go('download'), 'primary'));
    node.append(empty);
    return node;
  }
  const target = e('section', 'glass manager-target');
  target.append(e('span', 'field-label', '管理此游戏'), instancePicker());
  node.append(target, content);
  return node;
}

export function instanceMods() {
  const item = selected();
  const content = e('section', 'glass manager-content');
  content.append(e('h2', '', '本地 Mod'), e('p', 'muted', '启用、禁用、批量更新或移除当前游戏中的 Mod。禁用时会保留文件并改用 .zhumeng 后缀。'));
  if (item) content.append(localMods());
  return managerPage('Mod 管理', '只管理当前实例内已安装的模组。', content);
}

export function instanceSaves() {
  const item = selected();
  const content = e('section', 'glass manager-content');
  content.append(e('h2', '', '存档与备份'), e('p', 'muted', '浏览这个游戏目录中的世界，创建备份并在需要时恢复。恢复前会自动保护当前进度。'));
  if (item) content.append(worldBackupsView(item.id));
  return managerPage('存档管理', '世界列表、备份和恢复都在这个独立页面中完成。', content);
}
