<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PaintbrushIcon } from '@lucide/vue'

import ContentLayout from './content-layout.vue'
import CustomThemeTitle from './custom-theme-title.vue'
import CustomTheme from './custom-theme.vue'
import MenuStyle from './menu-style.vue'
import ToggleColorMode from './toggle-color-mode.vue'
</script>

<template>
  <Popover>
    <PopoverTrigger>
      <Button
        variant="outline"
        size="icon-sm"
        :aria-label="$t('customizeTheme')"
        :title="$t('customizeTheme')"
      >
        <PaintbrushIcon />
        <span class="sr-only">{{ $t('customizeTheme') }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end">
      <CustomThemeTitle />
      <CustomTheme />
      <ToggleColorMode />
      <ContentLayout />
      <MenuStyle />
    </PopoverContent>
  </Popover>
</template>
