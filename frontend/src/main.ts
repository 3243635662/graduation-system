import { createApp } from 'vue'

import App from './App.vue'
import { setupPlugins } from './plugins'

import '@/assets/index.css'
import '@/assets/auth-effects.css'
import '@/assets/scrollbar.css'
import '@/assets/themes.css'
import '@/assets/chart-theme.css'
import 'vue-sonner/style.css' // vue sonner style
import '@fontsource/open-sans/400.css'
import '@fontsource/open-sans/600.css'
import '@fontsource/open-sans/700.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'

import '@/utils/env'

function bootstrap() {
  const app = createApp(App)

  setupPlugins(app)

  app.mount('#app')
}

bootstrap()
