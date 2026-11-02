<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SELECTED_OPTION_CLASS } from '@/constants/themes'
import type { NavigationMode } from '@/stores/sidebar-config'
import { useSidebarConfigStore } from '@/stores/sidebar-config'
import { ChevronRightIcon, LayoutListIcon } from '@lucide/vue'
import { storeToRefs } from 'pinia'

const sidebarConfigStore = useSidebarConfigStore()
const { navigationMode } = storeToRefs(sidebarConfigStore)

const menuStyles: Array<{
  value: NavigationMode
  labelKey: string
  icon: any
  descriptionKey: string
}> = [
  {
    value: 'collapsible',
    labelKey: 'theme.menuStyleCollapsible',
    icon: LayoutListIcon,
    descriptionKey: 'theme.menuStyleCollapsibleDesc',
  },
  {
    value: 'vercel',
    labelKey: 'theme.menuStyleVercel',
    icon: ChevronRightIcon,
    descriptionKey: 'theme.menuStyleVercelDesc',
  },
]

function handleMenuStyleChange(style: NavigationMode) {
  sidebarConfigStore.setNavigationMode(style)
}
</script>

<template>
  <div class="space-y-1.5 pt-6">
    <Label for="menu-style" class="text-xs">
      {{ $t('theme.menuStyle') }}
    </Label>
    <div class="grid grid-cols-2 gap-2 py-1.5">
      <Button
        v-for="style in menuStyles"
        :key="style.value"
        variant="outline"
        class="justify-center h-8 px-3"
        :class="navigationMode === style.value ? SELECTED_OPTION_CLASS : ''"
        :title="$t(style.descriptionKey)"
        @click="handleMenuStyleChange(style.value)"
      >
        <component :is="style.icon" class="w-4 h-4" />
        {{ $t(style.labelKey) }}
      </Button>
    </div>
  </div>
</template>
