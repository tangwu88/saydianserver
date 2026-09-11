/// <reference types="vite/client" />

declare module "@dcloudio/uni-ui/lib/uni-icons/uni-icons.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
