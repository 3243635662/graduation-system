import { MoveHorizontalIcon, UnfoldHorizontalIcon } from '@lucide/vue'

export const THEMES = ['zinc', 'soft-pop', 'twitter', 'nature', 'claude', 'blossom'] as const
export type Theme = (typeof THEMES)[number]

export const THEME_PRIMARY_COLORS: { theme: Theme; primaryColor: string }[] = [
  { theme: 'zinc', primaryColor: 'oklch(44.2% 0.017 285.786)' },
  {
    theme: 'soft-pop',
    primaryColor: 'oklch(0.5106 0.2301 276.9656)',
  },
  {
    theme: 'twitter',
    primaryColor: 'oklch(0.6723 0.1606 244.9955)',
  },
  {
    theme: 'nature',
    primaryColor: 'oklch(0.5234 0.1347 144.1672)',
  },
  {
    theme: 'claude',
    primaryColor: 'oklch(0.6171 0.1375 39.0427)',
  },
  {
    theme: 'blossom',
    primaryColor: 'oklch(0.5316 0.1409 355.1999)',
  },
] as const

export type ContentLayout = 'full' | 'centered'
export const CONTENT_LAYOUTS = [
  { label: 'Full', value: 'full', icon: UnfoldHorizontalIcon },
  { label: 'Centered', value: 'centered', icon: MoveHorizontalIcon },
] as const

/**
 * 主题定制面板中「已选中」选项的样式。
 * 用 1px 主色边框 + 轻底色，避免 ring/加粗边框造成尺寸膨胀，且能覆盖 outline 变体的 dark:border-input。
 */
export const SELECTED_OPTION_CLASS =
  'border-primary dark:border-primary bg-primary/5 dark:bg-primary/10 text-primary hover:bg-primary/10 dark:hover:bg-primary/15'
