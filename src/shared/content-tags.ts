import type { ContentKind } from "./content";
export interface ContentTag {
  id: string;
  label: string;
  curseforge?: string;
  modrinth?: string;
}
// PCL 2.12.7.3 PageDownload*.xaml exact CF/MR facets.
export const contentTags: Record<ContentKind, ContentTag[]> = {
  mod: [
    {
      id: "mr-worldgen",
      label: "世界元素",
      curseforge: "406",
      modrinth: "worldgen",
    },
    {
      id: "cf-407",
      label: "生物群系",
      curseforge: "407",
    },
    {
      id: "cf-410",
      label: "维度",
      curseforge: "410",
    },
    {
      id: "cf-408",
      label: "矿物与资源",
      curseforge: "408",
    },
    {
      id: "cf-409",
      label: "天然结构",
      curseforge: "409",
    },
    {
      id: "mr-technology",
      label: "科技",
      curseforge: "412",
      modrinth: "technology",
    },
    {
      id: "cf-415",
      label: "管道与物流",
      curseforge: "415",
    },
    {
      id: "cf-4843",
      label: "自动化",
      curseforge: "4843",
    },
    {
      id: "cf-417",
      label: "能源",
      curseforge: "417",
    },
    {
      id: "cf-4558",
      label: "红石",
      curseforge: "4558",
    },
    {
      id: "mr-food",
      label: "食物与烹饪",
      curseforge: "436",
      modrinth: "food",
    },
    {
      id: "cf-416",
      label: "农业",
      curseforge: "416",
    },
    {
      id: "mr-game-mechanics",
      label: "游戏机制",
      modrinth: "game-mechanics",
    },
    {
      id: "mr-transportation",
      label: "运输",
      curseforge: "414",
      modrinth: "transportation",
    },
    {
      id: "mr-storage",
      label: "仓储",
      curseforge: "420",
      modrinth: "storage",
    },
    {
      id: "mr-magic",
      label: "魔法",
      curseforge: "419",
      modrinth: "magic",
    },
    {
      id: "mr-adventure",
      label: "冒险",
      curseforge: "422",
      modrinth: "adventure",
    },
    {
      id: "mr-decoration",
      label: "装饰",
      curseforge: "424",
      modrinth: "decoration",
    },
    {
      id: "mr-mobs",
      label: "生物",
      curseforge: "411",
      modrinth: "mobs",
    },
    {
      id: "mr-utility",
      label: "实用",
      curseforge: "5191",
      modrinth: "utility",
    },
    {
      id: "mr-equipment",
      label: "装备与工具",
      curseforge: "434",
      modrinth: "equipment",
    },
    {
      id: "cf-9026",
      label: "创造模式",
      curseforge: "9026",
    },
    {
      id: "mr-optimization",
      label: "性能优化",
      curseforge: "6814",
      modrinth: "optimization",
    },
    {
      id: "cf-423",
      label: "信息显示",
      curseforge: "423",
    },
    {
      id: "mr-social",
      label: "服务器",
      curseforge: "435",
      modrinth: "social",
    },
    {
      id: "mr-library",
      label: "支持库",
      curseforge: "421",
      modrinth: "library",
    },
  ],
  modpack: [
    {
      id: "cf-4484",
      label: "多人",
      curseforge: "4484",
    },
    {
      id: "mr-optimization",
      label: "性能优化",
      modrinth: "optimization",
    },
    {
      id: "mr-challenging",
      label: "硬核",
      curseforge: "4479",
      modrinth: "challenging",
    },
    {
      id: "mr-combat",
      label: "战斗",
      curseforge: "4483",
      modrinth: "combat",
    },
    {
      id: "mr-quests",
      label: "任务",
      curseforge: "4478",
      modrinth: "quests",
    },
    {
      id: "mr-technology",
      label: "科技",
      curseforge: "4472",
      modrinth: "technology",
    },
    {
      id: "mr-magic",
      label: "魔法",
      curseforge: "4473",
      modrinth: "magic",
    },
    {
      id: "mr-adventure",
      label: "冒险",
      curseforge: "4475",
      modrinth: "adventure",
    },
    {
      id: "mr-kitchen-sink",
      label: "水槽包",
      modrinth: "kitchen-sink",
    },
    {
      id: "cf-4476",
      label: "探索",
      curseforge: "4476",
    },
    {
      id: "cf-4477",
      label: "小游戏",
      curseforge: "4477",
    },
    {
      id: "cf-4474",
      label: "科幻",
      curseforge: "4474",
    },
    {
      id: "cf-4736",
      label: "空岛",
      curseforge: "4736",
    },
    {
      id: "cf-5128",
      label: "原版改良",
      curseforge: "5128",
    },
    {
      id: "cf-4487",
      label: "FTB",
      curseforge: "4487",
    },
    {
      id: "cf-4480",
      label: "基于地图",
      curseforge: "4480",
    },
    {
      id: "mr-lightweight",
      label: "轻量整合",
      curseforge: "4481",
      modrinth: "lightweight",
    },
    {
      id: "cf-4482",
      label: "大型整合",
      curseforge: "4482",
    },
  ],
  datapack: [
    {
      id: "mr-worldgen",
      label: "世界元素",
      modrinth: "worldgen",
    },
    {
      id: "mr-technology",
      label: "科技",
      curseforge: "6951",
      modrinth: "technology",
    },
    {
      id: "mr-game-mechanics",
      label: "游戏机制",
      modrinth: "game-mechanics",
    },
    {
      id: "mr-transportation",
      label: "运输",
      modrinth: "transportation",
    },
    {
      id: "mr-storage",
      label: "仓储",
      modrinth: "storage",
    },
    {
      id: "mr-magic",
      label: "魔法",
      curseforge: "6952",
      modrinth: "magic",
    },
    {
      id: "mr-adventure",
      label: "冒险",
      curseforge: "6948",
      modrinth: "adventure",
    },
    {
      id: "cf-6949",
      label: "幻想",
      curseforge: "6949",
    },
    {
      id: "mr-decoration",
      label: "装饰",
      modrinth: "decoration",
    },
    {
      id: "mr-mobs",
      label: "生物",
      modrinth: "mobs",
    },
    {
      id: "mr-utility",
      label: "实用",
      curseforge: "6953",
      modrinth: "utility",
    },
    {
      id: "mr-equipment",
      label: "装备与工具",
      modrinth: "equipment",
    },
    {
      id: "mr-optimization",
      label: "性能优化",
      modrinth: "optimization",
    },
    {
      id: "mr-social",
      label: "服务器",
      modrinth: "social",
    },
    {
      id: "mr-library",
      label: "支持库",
      curseforge: "6950",
      modrinth: "library",
    },
    {
      id: "cf-6946",
      label: "Mod 相关",
      curseforge: "6946",
    },
  ],
  shader: [
    {
      id: "mr-vanilla-like",
      label: "原版风",
      curseforge: "6555",
      modrinth: "vanilla-like",
    },
    {
      id: "mr-fantasy",
      label: "幻想风",
      curseforge: "6554",
      modrinth: "fantasy",
    },
    {
      id: "mr-realistic",
      label: "写实风",
      curseforge: "6553",
      modrinth: "realistic",
    },
    {
      id: "mr-semi-realistic",
      label: "半写实风",
      modrinth: "semi-realistic",
    },
    {
      id: "mr-cartoon",
      label: "卡通风",
      modrinth: "cartoon",
    },
    {
      id: "mr-colored-lighting",
      label: "彩色光照",
      modrinth: "colored-lighting",
    },
    {
      id: "mr-path-tracing",
      label: "路径追踪",
      modrinth: "path-tracing",
    },
    {
      id: "mr-pbr",
      label: "PBR",
      modrinth: "pbr",
    },
    {
      id: "mr-reflections",
      label: "反射",
      modrinth: "reflections",
    },
    {
      id: "mr-potato",
      label: "极低",
      modrinth: "potato",
    },
    {
      id: "mr-low",
      label: "低",
      modrinth: "low",
    },
    {
      id: "mr-medium",
      label: "中",
      modrinth: "medium",
    },
    {
      id: "mr-high",
      label: "高",
      modrinth: "high",
    },
    {
      id: "mr-vanilla",
      label: "原版可用",
      modrinth: "vanilla",
    },
    {
      id: "mr-iris",
      label: "Iris",
      modrinth: "iris",
    },
    {
      id: "mr-optifine",
      label: "OptiFine",
      modrinth: "optifine",
    },
  ],
  resourcepack: [
    {
      id: "mr-vanilla-like",
      label: "原版风",
      curseforge: "403",
      modrinth: "vanilla-like",
    },
    {
      id: "mr-realistic",
      label: "写实风",
      curseforge: "400",
      modrinth: "realistic",
    },
    {
      id: "cf-401",
      label: "现代风",
      curseforge: "401",
    },
    {
      id: "cf-402",
      label: "中世纪",
      curseforge: "402",
    },
    {
      id: "cf-399",
      label: "蒸汽朋克",
      curseforge: "399",
    },
    {
      id: "mr-themed",
      label: "主题化",
      modrinth: "themed",
    },
    {
      id: "mr-simplistic",
      label: "简洁",
      modrinth: "simplistic",
    },
    {
      id: "mr-decoration",
      label: "装饰",
      modrinth: "decoration",
    },
    {
      id: "mr-combat",
      label: "战斗",
      modrinth: "combat",
    },
    {
      id: "mr-utility",
      label: "实用",
      modrinth: "utility",
    },
    {
      id: "mr-tweaks",
      label: "改良",
      modrinth: "tweaks",
    },
    {
      id: "mr-cursed",
      label: "鬼畜",
      modrinth: "cursed",
    },
    {
      id: "mr-entities",
      label: "含实体",
      modrinth: "entities",
    },
    {
      id: "mr-audio",
      label: "含声音",
      modrinth: "audio",
    },
    {
      id: "mr-fonts",
      label: "含字体",
      curseforge: "5244",
      modrinth: "fonts",
    },
    {
      id: "mr-models",
      label: "含模型",
      modrinth: "models",
    },
    {
      id: "mr-locale",
      label: "含语言",
      modrinth: "locale",
    },
    {
      id: "mr-gui",
      label: "含 UI",
      modrinth: "gui",
    },
    {
      id: "mr-core-shaders",
      label: "核心着色器",
      modrinth: "core-shaders",
    },
    {
      id: "cf-404",
      label: "动态效果",
      curseforge: "404",
    },
    {
      id: "mr-modded",
      label: "兼容 Mod",
      curseforge: "4465",
      modrinth: "modded",
    },
    {
      id: "mr-8x-",
      label: "8x 或更低",
      modrinth: "8x-",
    },
    {
      id: "mr-16x",
      label: "16x",
      curseforge: "393",
      modrinth: "16x",
    },
    {
      id: "mr-32x",
      label: "32x",
      curseforge: "394",
      modrinth: "32x",
    },
    {
      id: "mr-48x",
      label: "48x",
      modrinth: "48x",
    },
    {
      id: "mr-64x",
      label: "64x",
      curseforge: "395",
      modrinth: "64x",
    },
    {
      id: "mr-128x",
      label: "128x",
      curseforge: "396",
      modrinth: "128x",
    },
    {
      id: "mr-256x",
      label: "256x",
      curseforge: "397",
      modrinth: "256x",
    },
    {
      id: "mr-512x+",
      label: "512x 或更高",
      curseforge: "398",
      modrinth: "512x+",
    },
  ],
};
export function resolveTag(
  kind: ContentKind,
  id: string,
  provider: "modrinth" | "curseforge" = "modrinth",
): ContentTag {
  const tag = contentTags[kind].find((t) => t.id === id);
  if (!tag) throw new Error("无效内容标签");
  if (!tag[provider])
    throw new Error(
      `此标签不支持当前来源 ${provider === "modrinth" ? "Modrinth" : "CurseForge"}`,
    );
  return tag;
}

// ResourceProject.vb Modrinth category badge labels, unknown categories remain literal.
const badges: Record<string, string> = {
  technology: "科技",
  magic: "魔法",
  adventure: "冒险",
  utility: "实用",
  optimization: "性能优化",
  "vanilla-like": "原版风",
  realistic: "写实风",
  worldgen: "世界元素",
  decoration: "装饰",
  mobs: "生物",
  equipment: "装备",
  food: "食物/烹饪",
  "game-mechanics": "游戏机制",
  transportation: "运输",
  storage: "仓储",
  social: "服务器",
  library: "支持库",
  multiplayer: "多人",
  challenging: "硬核",
  combat: "战斗",
  quests: "任务",
  "kitchen-sink": "水槽包",
  lightweight: "轻量",
  simplistic: "简洁",
  tweaks: "改良",
  "8x-": "极简",
  "16x": "16x",
  "32x": "32x",
  "48x": "48x",
  "64x": "64x",
  "128x": "128x",
  "256x": "256x",
  "512x+": "超高清",
  audio: "含声音",
  fonts: "含字体",
  models: "含模型",
  gui: "含 UI",
  locale: "含语言",
  "core-shaders": "核心着色器",
  modded: "兼容 Mod",
  fantasy: "幻想风",
  "semi-realistic": "半写实风",
  cartoon: "卡通风",
  "colored-lighting": "彩色光照",
  "path-tracing": "路径追踪",
  pbr: "PBR",
  reflections: "反射",
  iris: "Iris",
  optifine: "OptiFine",
  vanilla: "原版可用",
};
export function categoryLabel(category: string): string {
  return Object.hasOwn(badges, category) ? badges[category] : category;
}
