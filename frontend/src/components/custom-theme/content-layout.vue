<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CONTENT_LAYOUTS, SELECTED_OPTION_CLASS } from '@/constants/themes'
import { useThemeStore } from '@/stores/theme'
import { storeToRefs } from 'pinia'

const themeStore = useThemeStore()
const { setContentLayout } = themeStore
const { contentLayout } = storeToRefs(themeStore)
</script>

<template>
  <div class="space-y-1.5 pt-6">
    <Label for="radius" class="text-xs">
      {{ $t('theme.contentLayout') }}
    </Label>
    <div class="grid grid-cols-2 gap-2 py-1.5">
      <Button
        v-for="layout in CONTENT_LAYOUTS"
        :key="layout.label"
        variant="outline"
        class="justify-center h-8 px-3"
        :class="contentLayout === layout.value ? SELECTED_OPTION_CLASS : ''"
        @click="setContentLayout(layout.value)"
      >
        <component :is="layout.icon" />
        {{ $t(`theme.layout.${layout.value}`) }}
      </Button>
    </div>
  </div>
</template>
