import type { NavIcon } from '@/components/app-sidebar/types'
import {
  ActivityIcon,
  ArchiveIcon,
  AwardIcon,
  BookMarkedIcon,
  BookOpenIcon,
  BookmarkIcon,
  BotIcon,
  Building2Icon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  ContactIcon,
  FileCheck2Icon,
  FileSearchIcon,
  FileTextIcon,
  FolderKanbanIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  ListTreeIcon,
  NetworkIcon,
  PresentationIcon,
  SchoolIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  UploadIcon,
  UserCheckIcon,
  UserCogIcon,
  UserRoundIcon,
  UsersIcon,
} from '@lucide/vue'

/**
 * 菜单图标注册表
 * 后端 Menu.icon 存储字符串（如 LayoutDashboard），前端在此映射为组件。
 * 新增菜单时若图标未登记，会在控制台给出提示并使用空图标。
 */
const iconRegistry: Record<string, NavIcon> = {
  Activity: ActivityIcon,
  Archive: ArchiveIcon,
  Award: AwardIcon,
  BookMarked: BookMarkedIcon,
  BookOpen: BookOpenIcon,
  Bookmark: BookmarkIcon,
  Bot: BotIcon,
  Building2: Building2Icon,
  ClipboardCheck: ClipboardCheckIcon,
  ClipboardList: ClipboardListIcon,
  Contact: ContactIcon,
  FileCheck2: FileCheck2Icon,
  FileSearch: FileSearchIcon,
  FileText: FileTextIcon,
  FolderKanban: FolderKanbanIcon,
  GraduationCap: GraduationCapIcon,
  HeartHandshake: HeartHandshakeIcon,
  LayoutDashboard: LayoutDashboardIcon,
  Lightbulb: LightbulbIcon,
  ListTree: ListTreeIcon,
  Network: NetworkIcon,
  Presentation: PresentationIcon,
  School: SchoolIcon,
  ScrollText: ScrollTextIcon,
  Settings: SettingsIcon,
  ShieldCheck: ShieldCheckIcon,
  TrendingUp: TrendingUpIcon,
  Upload: UploadIcon,
  UserCheck: UserCheckIcon,
  UserCog: UserCogIcon,
  UserRound: UserRoundIcon,
  Users: UsersIcon,
}

export function resolveMenuIcon(icon?: string | null): NavIcon | undefined {
  if (!icon) return undefined

  const resolved = iconRegistry[icon]
  if (!resolved) {
    console.warn(`[menu] 未登记图标 "${icon}"，请在 src/router/dynamic/icons.ts 中补充映射`)
  }

  return resolved
}
