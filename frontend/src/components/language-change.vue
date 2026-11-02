<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Language } from '@/plugins/i18n'
import { appLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/plugins/i18n'
import { Icon } from '@iconify/vue'
import type { AcceptableValue } from 'reka-ui'
import { useI18n } from 'vue-i18n'

const { locale } = useI18n()

function setDefaultLanguage() {
  locale.value = DEFAULT_LOCALE
  appLocale.value = DEFAULT_LOCALE
}

function handleLocaleChange(val: AcceptableValue) {
  if (typeof val !== 'string' || !SUPPORTED_LOCALES.has(val as Language)) {
    setDefaultLanguage()
    return
  }

  locale.value = val as Language
  appLocale.value = val as Language
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="outline"
        size="icon-sm"
        :aria-label="$t('changeLanguage')"
        :title="$t('changeLanguage')"
      >
        <Icon icon="mdi:translate" />
        <span class="sr-only">{{ $t('changeLanguage') }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup v-model="locale" @update:model-value="handleLocaleChange">
        <DropdownMenuRadioItem value="en">
          <Icon icon="flag:us-4x3" />
          <span>English</span>
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="zh">
          <Icon icon="flag:cn-4x3" />
          <span>中文</span>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
