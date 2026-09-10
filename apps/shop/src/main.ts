import { createSSRApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.scss";
import { bridgeGlobalOAuth } from "./global-oauth";
import { normalizeGlobalEntry } from "./global-navigation";
// Before createApp / remote brand images: scrub OAuth credentials even on a failed callback.
bridgeGlobalOAuth();
normalizeGlobalEntry();
export function createApp() {
  const app = createSSRApp(App);
  app.use(createPinia());
  return { app };
}
