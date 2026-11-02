<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SELECTED_OPTION_CLASS } from '@/constants/themes'
import { MoonIcon, SunIcon, SunMoonIcon } from '@lucide/vue'
import type { BasicColorSchema } from '@vueuse/core'
import { useColorMode } from '@vueuse/core'
import type { Component } from 'vue'

const mode = useColorMode()

const colorModes: {
  colorMode: BasicColorSchema
  icon: Component
  label: string
}[] = [
  { colorMode: 'light', icon: SunIcon, label: 'theme.day' },
  { colorMode: 'dark', icon: MoonIcon, label: 'theme.night' },
  { colorMode: 'auto', icon: SunMoonIcon, label: 'theme.system' },
]

function setColorMode(colorMode: BasicColorSchema) {
  mode.value = colorMode
}
</script>

<template>
  <div class="space-y-1.5 pt-6">
    <Label for="radius" class="text-xs">
      {{ $t('theme.mode') }}
    </Label>
    <div class="grid grid-cols-3 gap-2 py-1.5">
      <Button
        v-for="item in colorModes"
        :key="item.colorMode"
        variant="outline"
        class="justify-center items-center h-8 px-3"
        :class="item.colorMode === mode ? SELECTED_OPTION_CLASS : ''"
        @click="setColorMode(item.colorMode)"
      >
        <component :is="item.icon" />
        <span class="text-xs">{{ $t(item.label) }}</span>
      </Button>
    </div>
  </div>
</template>
