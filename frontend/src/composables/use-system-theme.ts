import { THEMES } from '@/constants/themes'
import { useThemeStore } from '@/stores/theme'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'

export function useSystemTheme() {
  const themeStore = useThemeStore()
  const { setTheme } = themeStore
  const { theme } = storeToRefs(themeStore)

  if (typeof document !== 'undefined') {
    watch(
      theme,
      (theme) => {
        document.documentElement.classList.remove(...THEMES.map((t) => `theme-${t}`))
        document.documentElement.classList.add(`theme-${theme}`)
      },
      { immediate: true },
    )
  }

  return {
    theme,
    setTheme,
  }
}
