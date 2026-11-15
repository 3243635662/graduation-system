<script setup lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useAuth } from '@/composables/use-auth'
import { useAuthStore } from '@/stores/auth'
import { ChevronsUpDownIcon, LogOutIcon, UserRoundIcon } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

/**
 * 侧边栏底部用户菜单
 *
 * 用户信息统一来自 auth store（AuthUser.realName / avatarUrl），
 * 不再使用模板里的静态假数据；头像为空时回退到姓名首字。
 */
const router = useRouter()
const { logout } = useAuth()
const authStore = useAuthStore()
// 必须用 storeToRefs 保留响应性：直接解构 Store 会丢掉后续的更新
const { user } = storeToRefs(authStore)
const { isMobile } = useSidebar()

const displayName = computed(() => user.value?.realName || '未登录用户')
const email = computed(() => user.value?.email ?? '')
const avatarUrl = computed(() => user.value?.avatarUrl ?? '')
const roleText = computed(
  () => user.value?.roles.map((role) => role.name).join(' · ') || '暂无角色',
)

/** 头像占位：中文取姓名最后两字，英文取首字母 */
const avatarFallback = computed(() => {
  const name = displayName.value.trim()

  if (!name) return 'U'
  if (/^[\u4e00-\u9fa5]+$/.test(name)) return name.slice(-2)

  return name.slice(0, 1).toUpperCase()
})
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Avatar class="size-8 rounded-lg">
              <AvatarImage :src="avatarUrl" :alt="displayName" />
              <AvatarFallback class="rounded-lg text-xs">{{ avatarFallback }}</AvatarFallback>
            </Avatar>
            <div class="grid flex-1 text-sm leading-tight text-left">
              <span class="font-semibold truncate">{{ displayName }}</span>
              <span class="text-xs truncate">{{ roleText }}</span>
            </div>
            <ChevronsUpDownIcon class="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          class="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
          :side="isMobile ? 'bottom' : 'right'"
          align="end"
          :side-offset="4"
        >
          <DropdownMenuLabel class="p-0 font-normal">
            <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar class="size-8 rounded-lg">
                <AvatarImage :src="avatarUrl" :alt="displayName" />
                <AvatarFallback class="rounded-lg text-xs">{{ avatarFallback }}</AvatarFallback>
              </Avatar>
              <div class="grid flex-1 text-sm leading-tight text-left">
                <span class="font-semibold truncate">{{ displayName }}</span>
                <span v-if="email" class="text-xs truncate text-muted-foreground">{{ email }}</span>
              </div>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem @click="router.push('/profile')">
              <UserRoundIcon />
              个人资料
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem @click="logout">
            <LogOutIcon />
            {{ $t('logout') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
