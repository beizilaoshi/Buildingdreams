import { open, readAllEntries, openEntryReadStream } from "@xmcl/unzip";
import { validateArchive } from "./archive";
import type { LocalMod } from "../../shared/content";
type Metadata = Pick<LocalMod, "name" | "version" | "loader" | "parseWarning">;
function label(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value) && !value.includes("${") ? value.trim() : undefined;
}
// Only single-line quoted literal fields in the first [[mods]] table are supported.
// This deliberately does not claim to implement TOML interpolation or multiline strings.
function toml(text: string): { name?: string; version?: string } {
  // Fail closed on unsupported multiline strings before interpreting any apparent field.
  // Otherwise description content could impersonate a displayName assignment.
  if (text.includes('"""') || text.includes("'''")) throw new Error("不支持多行 TOML 字符串");
  for (const line of text.split(/\r?\n/)) {
    let quote: string | undefined;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (!quote) {
        if (char === "#") break;
        if (char === '"' || char === "'") quote = char;
      } else if (char === "\\" && quote === '"') index++;
      else if (char === quote) quote = undefined;
    }
    if (quote) throw new Error("不支持未闭合的 TOML 字符串");
  }
  const first = text.split(/^\s*\[\[mods\]\]\s*$/m)[1]?.split(/^\s*\[/m)[0];
  if (!first) throw new Error("不支持的 TOML 元数据结构");
  const field = (key: string) => label(first.match(new RegExp("^[ \\t]*"+key+"[ \\t]*=[ \\t]*([\"'])([^\"'\\r\\n\\\\]*)\\1[ \\t]*(?:#.*)?$", "m"))?.[2]);
  const name=field("displayName"),version=field("version");
  if (!name && !version) throw new Error("不支持的 TOML 元数据字段");
  return {name,version};
}
export async function modMetadata(path: string): Promise<Metadata> {
  try {
    const zip = await open(path,{lazyEntries:true,autoClose:false,strictFileNames:true});
    const archive = {
      entries: [] as Awaited<ReturnType<typeof readAllEntries>>,
      close:()=>zip.close(),
      async read(name:string,limit:number) {
        const entry=this.entries.find(e=>e.fileName===name);
        if(!entry || entry.uncompressedSize>limit)throw new Error("元数据过大");
        const stream=await openEntryReadStream(zip,entry),chunks:Buffer[]=[];let size=0;
        try {for await(const chunk of stream){size+=chunk.length;if(size>limit||size>entry.uncompressedSize)throw new Error("元数据大小无效");chunks.push(chunk);}if(size!==entry.uncompressedSize)throw new Error("元数据大小无效");return Buffer.concat(chunks);}
        finally{stream.destroy();}
      }
    };
    try {
      if(zip.entryCount>20000)throw new Error("JAR 条目过多");
      archive.entries=await readAllEntries(zip);
      validateArchive(archive.entries.map(e=>({path:e.fileName,size:e.uncompressedSize,symlink:((e.externalFileAttributes>>>16)&0xf000)===0xa000})));
      for (const [file, loader] of [["fabric.mod.json","fabric"],["quilt.mod.json","quilt"],["META-INF/neoforge.mods.toml","neoforge"],["META-INF/mods.toml","forge"]] as const) {
        if (!archive.entries.some(e => e.fileName === file)) continue;
        const text = (await archive.read(file, 128 * 1024)).toString("utf8");
        if (file.endsWith(".toml")) return {...toml(text),loader};
        const data = JSON.parse(text);
        const info = loader === "quilt" ? data.quilt_loader : data;
        if (!info || typeof info !== "object") throw new Error("无效元数据");
        const name = label(loader === "quilt" ? info.metadata?.name : info.name), version = label(info.version);
        if (!name && !version) throw new Error("元数据没有可验证名称或版本");
        return {name,version,loader};
      }
      return {};
    } finally {archive.close();}
  } catch {return {parseWarning:"无法读取或不支持的 Mod 元数据"};}
}
