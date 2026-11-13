import type { ContentProject, SearchPage } from "../../shared/content";
import { e, button } from "../ui";
import { compareMinecraftNames } from "../../shared/minecraft-versions";
export type ProjectIdentity = SearchPage["hits"][number];
export function projectIdentity(
  project: ContentProject,
  fallbackAuthor?: string,
): ProjectIdentity {
  return {
    provider: project.provider,
    project_id: project.id,
    title: project.title,
    chineseTitle: project.chineseTitle,
    categoryLabels: project.categoryLabels,
    description: project.description,
    icon_url: project.icon_url,
    author:
      project.authors.join("、") ||
      fallbackAuthor ||
      project.authorError ||
      "作者未知",
    downloads: project.downloads,
    categories: project.categories,
  };
}
export function projectRow(hit: ProjectIdentity, open?: () => void) {
  const row = open
    ? button("", open, "content-project-row")
    : e("div", "content-project-row content-project-header");
  const icon = e("span", "content-project-icon");
  const fallback = e("span", "content-icon-fallback", "◇");
  fallback.setAttribute("aria-label", "项目图标不可用");
  icon.append(fallback);
  if (hit.icon_url) {
    const image = document.createElement("img");
    image.alt = hit.title + " 图标";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.src = hit.icon_url;
    image.onload = () => {
      fallback.hidden = true;
    };
    image.onerror = () => {
      image.remove();
      fallback.hidden = false;
    };
    icon.append(image);
  }
  const copy = e("span", "content-project-copy");
  copy.append(
    e(open ? "h3" : "h2", "", hit.chineseTitle || hit.title),
    ...(hit.chineseTitle && hit.chineseTitle !== hit.title
      ? [e("span", "muted content-original-title", hit.title)]
      : []),
    e("span", "muted content-author", hit.author || "作者未知"),
    e("span", "content-summary", hit.description),
  );
  const meta = e(
    "span",
    "muted content-project-meta",
    `${hit.downloads.toLocaleString()} 次下载 · ${hit.provider === "curseforge" ? "CurseForge" : "Modrinth"}`,
  );
  if (hit.categories?.length)
    meta.append(
      e(
        "span",
        "content-tags",
        (hit.categoryLabels ?? hit.categories).slice(0, 6).join(" · "),
      ),
    );
  copy.append(meta);
  if (hit.versions?.length) {
    const versions = [...hit.versions].sort(compareMinecraftNames);
    copy.append(
      e(
        "span",
        "muted content-project-meta",
        `Minecraft ${versions.slice(0, 3).join(" / ")}${versions.length > 3 ? ` 等 ${versions.length} 个版本` : ""}`,
      ),
    );
  }
  if (hit.date_modified)
    copy.append(
      e(
        "span",
        "muted content-project-meta",
        `更新于 ${new Date(hit.date_modified).toLocaleDateString("zh-CN")}`,
      ),
    );
  row.append(icon, copy);
  if (open) row.append(e("span", "content-row-arrow", "›"));
  return row;
}
