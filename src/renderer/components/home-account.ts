import { account, state, e, button, go, openAccounts, selectAccount, selectAccountKind } from '../ui';
import { choice } from './choice';
import { avatar } from './avatar';
import { dialog } from './dialog';
import { localAccountDialog, microsoftLogin } from './account-manager';
import './home-account.css';

export function addHomeAccount() {
  if (state.accountKind === 'microsoft') microsoftLogin(() => go('home'));
  else localAccountDialog(undefined, () => go('home'));
}
export function homeAccount() {
  const node = e('aside', 'glass home-aside home-account');
  account();
  const modes = choice([['local', '离线游戏'], ['microsoft', '微软正版']], state.accountKind);
  modes.setAttribute('aria-label', '登录方式');
  const content = e('div', 'home-account-content');
  const paint = () => {
    const identity = account();
    const microsoft = state.accountKind === 'microsoft';
    const player = e('div', 'player-summary');
    const info = e('div', 'player-info');
    info.append(e('h3', '', identity?.name ?? (microsoft ? '尚未登录正版账号' : '尚未添加本地身份')), e('p', 'muted', identity ? microsoft ? identity.status === 'ready' ? 'Microsoft · 正版账号' : 'Microsoft · 需要重新登录' : '本地身份 · 离线游戏' : microsoft ? '登录拥有 Minecraft Java 版的 Microsoft 账号' : '添加玩家名，准备离线游戏'));
    player.append(avatar(identity), info);
    const actions = e('div', 'row account-actions');
    const identities = state.accounts.filter(x => x.kind === state.accountKind);
    if (identities.length > 1) actions.append(button('切换账号', () => {
      const picker = choice(identities.map(x => [x.id, x.name]), account()?.id);
      picker.setAttribute('aria-label', '当前账号');
      const modal = dialog('选择账号', picker);
      picker.onchange = () => {
        const selected = identities.find(x => x.id === picker.value);
        if (selected) selectAccount(selected);
        modal.close(); paint();
      };
    }, 'quiet'));
    if (identity?.kind === 'local') actions.append(button('修改名字', () => localAccountDialog(identity, paint), 'text-button'));
    actions.append(button(microsoft ? identity ? identity.status === 'ready' ? '登录其他账号' : '重新登录' : '登录 Microsoft' : '添加本地账号', addHomeAccount, 'text-button'));
    // Retain the full multiaccount manager as a separate explicit destination.
    actions.append(button(identity ? '账号设置 →' : '登录 / 添加账号 →', openAccounts, 'text-button'));
    content.replaceChildren(player, actions);
  };
  modes.onchange = () => { selectAccountKind(modes.value as 'local' | 'microsoft'); paint(); };
  node.append(e('p', 'eyebrow', '旅途信息'), modes, content);
  paint();
  return node;
}
