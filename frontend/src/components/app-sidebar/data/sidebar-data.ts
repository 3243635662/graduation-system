import { AudioWaveformIcon, CommandIcon, GalleryVerticalEndIcon } from '@lucide/vue'

import type { SidebarData, Team } from '../types'

const teams: Team[] = [
  {
    name: '毕业设计管理系统',
    logo: GalleryVerticalEndIcon,
    plan: 'Graduation System',
  },
  {
    name: '教务处',
    logo: AudioWaveformIcon,
    plan: 'Academic Affairs',
  },
  {
    name: '信息中心',
    logo: CommandIcon,
    plan: 'IT Center',
  },
]

/**
 * 侧边栏静态部分
 *
 * navMain 与 user 都已移出：菜单来自后端，用户信息来自 auth store。
 */
export const sidebarData: SidebarData = {
  teams,
}
