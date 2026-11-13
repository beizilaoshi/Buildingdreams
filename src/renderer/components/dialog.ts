import { e, button } from "../ui";
export function dialog(title: string, content: HTMLElement) {
  const node = document.createElement("dialog");
  node.setAttribute("aria-label", title);
  node.className = "glass dialog";
  const top = e("div", "row between");
  top.append(
    e("h2", "", title),
    button("关闭", () => node.close(), "quiet"),
  );
  node.append(top, content);
  document.body.append(node);
  node.addEventListener("close", () => node.remove(), { once: true });
  node.showModal();
  return node;
}
