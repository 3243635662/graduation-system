import { MoveHorizontalIcon, UnfoldHorizontalIcon } from '@lucide/vue'

export const THEMES = ['zinc', 'soft-pop', 'twitter'] as const
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
] as const

export type ContentLayout = 'full' | 'centered'
export const CONTENT_LAYOUTS = [
  { label: 'Full', value: 'full', icon: UnfoldHorizontalIcon },
  { label: 'Centered', value: 'centered', icon: MoveHorizontalIcon },
] as const
