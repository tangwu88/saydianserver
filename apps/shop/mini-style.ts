import { parse } from "vue/compiler-sfc";

const semantic: Record<string, string> = { b: "text", strong: "text", span: "text", em: "text", small: "text", h1: "view", h2: "view", h3: "view", h4: "view", h5: "view", h6: "view", p: "view" };
const native = new Set(["view", "text", "image", "button", "input", "textarea", "label", "picker", "scroll-view", "swiper", "swiper-item", "rich-text", "canvas", "checkbox", "checkbox-group"]);
const tags = [...native, ...Object.keys(semantic)].join("|");

// Keep H5 source and semantics intact. Mini selectors must address classes;
// otherwise component WXSS drops HTML/native type selectors during rendering.
export function miniSelectors(css: string): string {
  return css.replace(/([^{};]+)\{/g, (rule, selector: string) => {
    const mapped = selector.replace(new RegExp(`(^|[\\s>+~,])(${tags})(?=[\\s>+~,.#:\\[]|$)`, "g"), "$1.mini-$2");
    return mapped.replace(/\[disabled\]/g, ".mini-disabled").replace(/(^|[\s>+~,])\*(?=[\s>+~,.#:]|$)/g, "$1.mini-node") + "{";
  });
}

export function miniVueStyles(source: string, filename: string): string {
  const { descriptor, errors } = parse(source, { filename });
  if (errors.length) throw new Error(`Cannot adapt mini styles: ${filename}`);
  const edits: { start: number; end: number; value: string }[] = [];
  const template = descriptor.template;
  if (template?.ast) {
    const walk = (node: any) => {
      if (node.type === 1 && (native.has(node.tag) || semantic[node.tag])) {
        const base = 0; // compiler-sfc AST locations refer to the full SFC.
        const start = base + node.loc.start.offset;
        const tag = node.tag;
        const replacement = semantic[tag];
        if (replacement) {
          edits.push({ start: start + 1, end: start + 1 + tag.length, value: replacement });
          const closing = [...node.loc.source.matchAll(new RegExp(`</${tag}(?=[\\s>])`, "g"))].at(-1);
          if (closing && !node.isSelfClosing) edits.push({ start: start + closing.index! + 2, end: start + closing.index! + 2 + tag.length, value: replacement });
        }
        const classes = `mini-node mini-${tag}`;
        const existing = node.props.find((p: any) => p.type === 6 && p.name === "class");
        if (existing?.value) {
          edits.push({ start: base + existing.loc.start.offset, end: base + existing.loc.end.offset, value: `class="${existing.value.content} ${classes}"` });
        } else {
          edits.push({ start: start + 1 + tag.length, end: start + 1 + tag.length, value: ` class="${classes}"` });
        }
        const disabled = node.props.find((p: any) => p.type === 7 && p.name === "bind" && p.arg?.content === "disabled");
        if (disabled?.exp) {
          const binding = node.props.find((p: any) => p.type === 7 && p.name === "bind" && p.arg?.content === "class");
          const expression = `{ 'mini-disabled': !!(${disabled.exp.content}) }`;
          if (binding?.exp) edits.push({ start: base + binding.exp.loc.start.offset, end: base + binding.exp.loc.end.offset, value: `[${binding.exp.content}, ${expression}]` });
          else edits.push({ start: start + 1 + tag.length, end: start + 1 + tag.length, value: ` :class="${expression}"` });
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(template.ast);
  }
  for (const style of descriptor.styles) edits.push({ start: style.loc.start.offset, end: style.loc.end.offset, value: miniSelectors(style.content) });
  if (filename.replace(/\\/g, "/").includes("/components/") && descriptor.scriptSetup) {
    edits.push({ start: descriptor.scriptSetup.loc.start.offset, end: descriptor.scriptSetup.loc.start.offset, value: '\ndefineOptions({ options: { styleIsolation: "shared" } });\n' });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}
