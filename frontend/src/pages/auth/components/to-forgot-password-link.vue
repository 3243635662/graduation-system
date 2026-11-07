<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { toast } from 'vue-sonner'

/**
 * 密码找回暂未开放。
 *
 * 不跳转到空的找回密码页，避免误导用户；改为明确的提示。
 */
function handleClick() {
  toast.info('找回密码功能暂未开放，请联系管理员重置密码')
}
</script>

<template>
  <Button type="button" variant="link" class="px-0 text-muted-foreground" @click="handleClick">
    忘记密码？
  </Button>
</template>
