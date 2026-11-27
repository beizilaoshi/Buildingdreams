import { api, state, panel, input, field, button, notify } from '../ui';

export function networkSettingsCard(): HTMLElement {
  const card = panel('下载网络', '所有下载任务共享并发数与总带宽；保存后立即生效。降低并发时，已开始的下载完成后再排队。');
  const concurrency = input(String(state.settings.downloadConcurrency));
  concurrency.type = 'number'; concurrency.min = '1'; concurrency.max = '64'; concurrency.step = '1';
  const speed = input(String(state.settings.downloadSpeedLimitKib));
  speed.type = 'number'; speed.min = '0'; speed.max = '1048576'; speed.step = '1';
  const source = document.createElement('select');
  for (const [value, label] of [['auto', '自动：官方优先，失败时镜像回退'], ['official', '仅官方'], ['bmclapi', '镜像优先，失败时官方回退']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; source.append(option);
  }
  source.value = state.settings.downloadSource;
  card.append(field('全局同时下载数（1–64）', concurrency), field('总下载限速（KB/s，1 KB = 1024 字节；0 为不限速）', speed), field('Minecraft 下载源', source), button('保存下载设置', async () => {
    const downloadConcurrency = Number(concurrency.value), downloadSpeedLimitKib = Number(speed.value);
    if (!concurrency.value.trim() || !speed.value.trim()) throw Error('请填写并发数和限速');
    state.settings = await api('settings.patch', { downloadConcurrency, downloadSpeedLimitKib, downloadSource: source.value as 'auto' | 'official' | 'bmclapi' });
    concurrency.value = String(state.settings.downloadConcurrency); speed.value = String(state.settings.downloadSpeedLimitKib);
    source.value = state.settings.downloadSource;
    notify('下载设置已保存并生效');
  }, 'primary'));
  return card;
}
