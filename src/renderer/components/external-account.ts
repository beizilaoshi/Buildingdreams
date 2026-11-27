import type { AccountSummary } from '../../shared/types';
import type { ExternalServer } from '../../shared/external-auth';
import { api, e, button, panel, input, field, refresh, selectAccount } from '../ui';
import { choice } from './choice';
import { dialog } from './dialog';
const errorText = (e: unknown) => String(e).replace(/^Error:\s*/, '');
export function externalLogin(done: () => unknown = () => { }, serverId?: string) {
    const form = e('form'), status = e('p', 'account-error');
    status.setAttribute('role', 'alert');
    const server = choice([]), username = input('', '输入此服务的账户名或邮箱'), password = input();
    password.type = 'password';
    password.autocomplete = 'current-password';
    username.autocomplete = 'username';
    server.setAttribute('aria-label', '外置认证服务器');
    form.append(field('认证服务器', server), field('账户', username), field('密码', password), status);
    const modal = dialog('外置登录', form);
    let active = true, busy = false, attemptId: string | undefined;
    const leave = () => modal.close();
    window.addEventListener('navigate', leave);
    modal.addEventListener('close', () => { active = false; password.value = ''; window.removeEventListener('navigate', leave); if (attemptId)
        void api('external.cancel', attemptId).catch(() => { }); }, { once: true });
    const login = button('登录', async () => { if (busy)
        return; status.textContent = ''; if (!server.value || !username.value || !password.value) {
        status.textContent = '请选择服务器并填写账户和密码';
        return;
    } busy = true; login.disabled = true; attemptId = crypto.randomUUID(); const secret = password.value; password.value = ''; try {
        const result = await api('external.login', { serverId: server.value, username: username.value, password: secret, attemptId });
        if (!active)
            return;
        if (result.status === 'completed') {
            await accept(result.account);
            return;
        }
        const roles = choice(result.profiles.map(p => [p.id, p.name]));
        roles.setAttribute('aria-label', '游戏角色');
        const choose = button('使用所选角色', async () => { choose.disabled = true; try {
            const account = await api('external.selectProfile', { attemptId: result.attemptId, profileId: roles.value });
            if (active)
                await accept(account);
        }
        catch (err) {
            if (active)
                status.textContent = errorText(err);
        }
        finally {
            choose.disabled = false;
        } }, 'primary');
        form.replaceChildren(e('p', 'muted', '此账户拥有多个角色，请选择本次保存的游戏身份。'), roles, status, choose, button('取消', () => modal.close(), 'quiet'));
    }
    catch (err) {
        if (active)
            status.textContent = errorText(err);
    }
    finally {
        busy = false;
        login.disabled = false;
    } }, 'primary');
    async function accept(account: AccountSummary) { selectAccount(account); await refresh(); if (active) {
        attemptId = undefined;
        modal.close();
        done();
    } }
    form.append(login, button('取消', () => modal.close(), 'quiet'));
    form.onsubmit = event => { event.preventDefault(); login.click(); };
    void api('external.servers', undefined).then(servers => { if (!active)
        return; server.setOptions(servers.map(s => ({ value: s.id, label: s.name + ' · ' + new URL(s.url).host })), serverId ?? servers[0]?.id); if (!servers.length)
        status.textContent = '请先在账号设置中添加认证服务器。'; }).catch(err => { if (active)
        status.textContent = errorText(err); });
    return modal;
}
export function externalSignout(account: AccountSummary, done: () => unknown) { const form = e('form'); const password = input(); password.type = 'password'; password.autocomplete = 'current-password'; const status = e('p', 'account-error'); status.setAttribute('role', 'alert'); form.append(e('p', 'muted', '注销将撤销此服务中该用户的全部登录令牌，包括其他启动器会话，并移除本启动器中该用户的角色。'), field('再次输入该服务的密码', password), status); const modal = dialog('注销外置账户', form); modal.addEventListener('close', () => { password.value = ''; }, { once: true }); const submit = button('注销全部会话', async () => { submit.disabled = true; const secret = password.value; password.value = ''; try {
    await api('external.signout', { id: account.id, password: secret });
    await refresh();
    modal.close();
    done();
}
catch (err) {
    status.textContent = errorText(err);
}
finally {
    submit.disabled = false;
} }, 'primary'); form.append(submit, button('取消', () => modal.close(), 'quiet')); form.onsubmit = ev => { ev.preventDefault(); submit.click(); }; }
export function externalAccountsPanel(done: () => unknown = () => { }) {
    const node = panel('外置认证服务器', '支持 Yggdrasil / LittleSkin。账户密码只发送至你配置的 HTTPS 服务；外置账户用于相应服务器。');
    const list = e('div'), status = e('p', 'account-error');
    status.setAttribute('role', 'alert');
    const url = input('', 'https://littleskin.cn/api/yggdrasil');
    url.type = 'url';
    const injector = e('p', 'muted', '正在检查注入组件…');
    let busy = false;
    const load = async () => { try {
        const servers = await api('external.servers', undefined);
        list.replaceChildren();
        for (const s of servers) {
            const row = e('div', 'version-row');
            const name = e('span', '', s.name);
            name.title = s.url;
            row.append(name, e('small', 'muted', s.url), button('登录', () => externalLogin(done, s.id), 'quiet'));
            if (s.registerUrl)
                row.append(button('注册', () => void run(() => api('external.openRegistration', s.id)), 'quiet'));
            row.append(button('移除服务', () => void run(async () => { await api('external.removeServer', s.id); await load(); }), 'quiet'));
            list.append(row);
        }
        if (!servers.length)
            list.append(e('p', 'muted', '尚未添加认证服务器。'));
        const agent = await api('external.injectorStatus', undefined);
        injector.textContent = agent.ready ? 'authlib-injector ' + agent.version + ' · SHA-256 已校验' : '游戏注入组件尚未准备。请点击下方按钮从官方发布下载并校验。';
    }
    catch (err) {
        status.textContent = errorText(err);
    } };
    async function run(work: () => Promise<unknown>) { if (busy)
        return; busy = true; status.textContent = ''; try {
        await work();
    }
    catch (err) {
        status.textContent = errorText(err);
    }
    finally {
        busy = false;
    } }
    const add = button('添加服务器', () => void run(async () => { await api('external.addServer', url.value.trim()); url.value = ''; await load(); }), 'quiet');
    node.append(list, field('服务器 API 地址（支持自动识别）', url), add, button('添加 LittleSkin', () => void run(async () => { await api('external.addServer', 'https://littleskin.cn/api/yggdrasil'); await load(); }), 'quiet'), injector, button('从官方发布准备 / 更新注入组件', () => void run(async () => { injector.textContent = '正在下载并校验官方 authlib-injector…'; try {
        await api('external.prepareInjector', undefined);
    }
    finally {
        await load();
    } }), 'quiet'), status, e('p', 'muted', '统一通行证 Nide 暂无已验证适配，不提供虚假的可用登录入口。'));
    void load();
    return node;
}
