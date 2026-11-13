import type { CommandMap } from '../shared/types';
interface SenderEvent { sender: { id: number; mainFrame: unknown }; senderFrame: { url: string } | null; }
export function assertTrustedSender(event: SenderEvent, windowId: number, applicationUrl: string): void {
  if (event.sender.id !== windowId || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== applicationUrl) throw new Error('拒绝非应用主框架请求');
}
export class CommandRouter {
  private handlers = new Map<string, { validate: (payload: unknown) => unknown; run: (payload: any) => Promise<unknown> }>();
  register<K extends keyof CommandMap>(command: K, validate: (payload: unknown) => CommandMap[K]['payload'], run: (payload: CommandMap[K]['payload']) => Promise<CommandMap[K]['result']>): void {
    if (this.handlers.has(command)) throw new Error(`重复命令: ${command}`);
    this.handlers.set(command, { validate, run });
  }
  async invoke(command: unknown, payload: unknown): Promise<unknown> {
    if (typeof command !== 'string' || !this.handlers.has(command)) throw new Error('未知命令');
    const encoded = JSON.stringify(payload);
    if (encoded && encoded.length > 65536) throw new Error('请求过大');
    const handler = this.handlers.get(command)!;
    return handler.run(handler.validate(payload));
  }
}
export function noPayload(value: unknown): undefined {
  if (value !== undefined) throw new Error('此命令不接受参数');
  return undefined;
}
