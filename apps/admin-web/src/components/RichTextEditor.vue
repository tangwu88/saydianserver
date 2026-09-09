<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const editor = ref<HTMLElement | null>(null);
const savedRange = ref<Range | null>(null);

const allowedTags = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "DIV", "EM", "H2", "H3", "H4", "I", "LI", "OL", "P", "S", "SPAN", "STRONG", "U", "UL",
]);

function normalizeLink(value: string): string {
  const href = value.trim();
  if (!href) return "";
  if (/^www\./i.test(href)) return `https://${href}`;
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href) ? href : "";
}

function sanitizeHtml(value: string): string {
  const documentNode = new DOMParser().parseFromString(value || "", "text/html");
  const cleanChildren = (parent: Element): void => {
    [...parent.childNodes].forEach((node) => {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as HTMLElement;
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(documentNode.createTextNode(element.textContent || ""));
        return;
      }
      const href = element.tagName === "A"
        ? normalizeLink((element as HTMLAnchorElement).getAttribute("href") || "")
        : "";
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      if (element.tagName === "A") {
        if (href) {
          element.setAttribute("href", href);
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer");
        }
      }
      cleanChildren(element);
    });
  };
  cleanChildren(documentNode.body);
  return documentNode.body.innerHTML.trim();
}

function applyModelValue(value: string): void {
  const nextValue = sanitizeHtml(value);
  if (editor.value && editor.value.innerHTML !== nextValue) editor.value.innerHTML = nextValue;
}

function captureSelection(): void {
  const selection = window.getSelection();
  const target = editor.value;
  if (!selection?.rangeCount || !target) return;
  const range = selection.getRangeAt(0);
  if (target.contains(range.commonAncestorContainer)) savedRange.value = range.cloneRange();
}

function restoreSelection(): boolean {
  const target = editor.value;
  if (!target || !savedRange.value) return false;
  target.focus();
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(savedRange.value);
  return true;
}

function emitHtml(): void {
  const target = editor.value;
  if (!target) return;
  emit("update:modelValue", sanitizeHtml(target.innerHTML));
}

function normalizeEditor(): void {
  const target = editor.value;
  if (!target) return;
  const nextValue = sanitizeHtml(target.innerHTML);
  if (target.innerHTML !== nextValue) target.innerHTML = nextValue;
  emit("update:modelValue", nextValue);
}

function runCommand(command: string, value?: string): void {
  if (!restoreSelection()) {
    ElMessage.warning("请先在正文中放置光标或选中要编辑的文字");
    return;
  }
  document.execCommand(command, false, value);
  captureSelection();
  emitHtml();
}

async function insertLink(): Promise<void> {
  if (!savedRange.value || savedRange.value.collapsed) {
    ElMessage.warning("请先选中要添加链接的文字");
    return;
  }
  try {
    const result = await ElMessageBox.prompt("仅支持 https/http、站内路径、锚点、mailto 或 tel 链接。", "插入链接", {
      inputPlaceholder: "https://example.com",
      inputValidator: (value) => Boolean(normalizeLink(value)) || "请输入安全的链接地址",
      confirmButtonText: "插入",
      cancelButtonText: "取消",
    });
    if (!restoreSelection()) return;
    document.execCommand("createLink", false, normalizeLink(result.value));
    editor.value?.querySelectorAll("a").forEach((anchor) => {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    });
    captureSelection();
    emitHtml();
  } catch { /* user cancelled the link dialog */ }
}

onMounted(() => {
  document.execCommand("defaultParagraphSeparator", false, "p");
  applyModelValue(props.modelValue);
});

watch(() => props.modelValue, async (value) => {
  await nextTick();
  applyModelValue(value);
}, { immediate: true });
</script>

<template>
  <section class="rich-text-editor">
    <div class="editor-toolbar" role="toolbar" aria-label="正文格式工具">
      <el-button size="small" @mousedown.prevent="runCommand('formatBlock', '<p>')">正文</el-button>
      <el-button size="small" @mousedown.prevent="runCommand('formatBlock', '<h2>')">标题 2</el-button>
      <el-button size="small" @mousedown.prevent="runCommand('formatBlock', '<h3>')">标题 3</el-button>
      <span class="toolbar-divider" />
      <el-button size="small" @mousedown.prevent="runCommand('bold')"><strong>B</strong></el-button>
      <el-button size="small" @mousedown.prevent="runCommand('italic')"><em>I</em></el-button>
      <el-button size="small" @mousedown.prevent="runCommand('underline')"><u>U</u></el-button>
      <span class="toolbar-divider" />
      <el-button size="small" @mousedown.prevent="runCommand('insertUnorderedList')">无序列表</el-button>
      <el-button size="small" @mousedown.prevent="runCommand('insertOrderedList')">有序列表</el-button>
      <el-button size="small" @mousedown.prevent="runCommand('formatBlock', '<blockquote>')">引用</el-button>
      <el-button size="small" @mousedown.prevent="insertLink">链接</el-button>
      <el-button size="small" @mousedown.prevent="runCommand('removeFormat')">清除格式</el-button>
    </div>
    <div
      ref="editor"
      class="editor-content"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      spellcheck="true"
      data-placeholder="输入正文；可用工具栏设置标题、重点、列表、引用和链接"
      @input="emitHtml"
      @blur="normalizeEditor"
      @keyup="captureSelection"
      @mouseup="captureSelection"
    />
    <p class="editor-help">保存为 HTML；编辑器会移除脚本、事件属性和不安全链接。</p>
  </section>
</template>

<style scoped>
.rich-text-editor { overflow: hidden; border: 1px solid #dcdfe6; border-radius: 4px; background: #fff; }
.editor-toolbar { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; padding: 10px; border-bottom: 1px solid #e4e7ed; background: #f8fafc; }
.toolbar-divider { width: 1px; height: 22px; background: #dcdfe6; }
.editor-content { min-height: 280px; max-height: 440px; padding: 14px 16px; overflow: auto; color: #303133; line-height: 1.8; outline: none; }
.editor-content:empty::before { color: #a8abb2; content: attr(data-placeholder); pointer-events: none; }
.editor-content:focus { box-shadow: inset 0 0 0 1px #409eff; }
.editor-help { margin: 0; padding: 8px 14px; border-top: 1px solid #f0f2f5; color: #909399; background: #fafafa; font-size: 12px; }
:deep(.editor-content h2) { margin: 18px 0 10px; font-size: 22px; line-height: 1.35; }
:deep(.editor-content h3) { margin: 16px 0 8px; font-size: 18px; line-height: 1.45; }
:deep(.editor-content p) { margin: 0 0 12px; }
:deep(.editor-content ul), :deep(.editor-content ol) { padding-left: 24px; }
:deep(.editor-content blockquote) { margin: 12px 0; padding: 8px 14px; border-left: 4px solid #409eff; color: #606266; background: #f5faff; }
:deep(.editor-content a) { color: #337ecc; text-decoration: underline; }
</style>
