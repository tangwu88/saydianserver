import { createSSRApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.scss";
export function createApp() {
  const app = createSSRApp(App);
  app.use(createPinia());
  return { app };
}
