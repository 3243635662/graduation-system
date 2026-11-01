import type { ContentLayout, Theme } from '@/constants/themes'
import { defineStore } from 'pinia'

export const useThemeStore = defineStore(
  'system-config',
  () => {
    const theme = shallowRef<Theme>('zinc')
    function setTheme(newTheme: Theme) {
      theme.value = newTheme
    }

    const contentLayout = shallowRef<ContentLayout>('centered')
    function setContentLayout(newContentLayout: ContentLayout) {
      contentLayout.value = newContentLayout
    }
    return {
      theme,
      setTheme,

      contentLayout,
      setContentLayout,
    }
  },
  {
    persist: {
      storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    },
  },
)
