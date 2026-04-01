import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import SweepList from "./pages/SweepList.vue";
import SweepDetail from "./pages/SweepDetail.vue";
import LayerDrillDown from "./pages/LayerDrillDown.vue";
import RunBrowser from "./pages/RunBrowser.vue";
import "./style.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: SweepList },
    { path: "/sweeps/:index", component: SweepDetail, props: true },
    { path: "/sweeps/:index/layers/:layer", component: LayerDrillDown, props: true },
    { path: "/runs", component: RunBrowser },
  ],
});

const app = createApp(App);
app.use(router);
app.mount("#app");
