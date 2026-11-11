<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

const { t } = useI18n()

/**
 * 密码找回暂未开放。
 *
 * 不跳转到空的找回密码页，避免误导用户；改为明确的提示。
 */
function handleClick() {
  toast.info(t('loginForm.forgotUnavailable'))
}
</script>

<template>
  <Button type="button" variant="link" class="px-0 text-muted-foreground" @click="handleClick">
    {{ $t('forgotPassword') }}
  </Button>
</template>
