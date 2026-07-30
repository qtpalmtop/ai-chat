import { createSSRApp } from 'vue';
import { setupPinia } from '@/stores/pinia';
import App from './App.vue';
import './style.css';

export function createApp() {
  const app = createSSRApp(App);
  app.use(setupPinia());
  return { app };
}

const { app } = createApp();
app.mount('#app');
