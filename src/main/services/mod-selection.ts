import { randomUUID } from "node:crypto";
import { basename } from "node:path";
// Renderer receives an opaque, one-use selection capability, never an arbitrary path import API.
const selections = new Map<string, {paths:string[]; expires:number}>();
export function rememberModSelection(paths: string[]) {
  for (const [id, entry] of selections) if (entry.expires < Date.now()) selections.delete(id);
  if (!paths.length || paths.length > 200) throw new Error("请选择 1 至 200 个 Mod");
  selections.clear();
  const selectionId = randomUUID();
  selections.set(selectionId,{paths:[...paths],expires:Date.now()+10*60*1000});
  return {selectionId, names:paths.map(p=>basename(p))};
}
export function consumeModSelection(id: string): string[] {
  const entry = selections.get(id); selections.delete(id);
  if (!entry || entry.expires < Date.now()) throw new Error("文件选择已失效，请重新选择");
  return entry.paths;
}
