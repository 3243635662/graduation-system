<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SELECTED_OPTION_CLASS, THEME_PRIMARY_COLORS } from '@/constants/themes'
import { useThemeStore } from '@/stores/theme'
import { storeToRefs } from 'pinia'

const themeStore = useThemeStore()
const { setTheme } = themeStore
const { theme: t } = storeToRefs(themeStore)
</script>

<template>
  <div class="space-y-1.5 pt-6">
    <Label for="radius" class="text-xs"> {{ $t('theme.theme') }} </Label>
    <div class="grid grid-cols-2 gap-2 py-1.5">
      <Button
        v-for="theme in THEME_PRIMARY_COLORS"
        :key="theme.theme"
        variant="outline"
        class="justify-center h-8 px-3"
        :class="t === theme.theme ? SELECTED_OPTION_CLASS : ''"
        @click="setTheme(theme.theme)"
      >
        <span
          :style="{
            '--theme-primary': theme.primaryColor,
          }"
          class="size-2 rounded-full bg-(--theme-primary)"
        />
        <span class="text-xs">
          {{ $t(`theme.names.${theme.theme}`) }}
        </span>
      </Button>
    </div>
  </div>
</template>
