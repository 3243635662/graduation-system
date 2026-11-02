import router from '@/router'
import type { App } from 'vue'

export function setupRouter(app: App) {
  app.use(router)
}
