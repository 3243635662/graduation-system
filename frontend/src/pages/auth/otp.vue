<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import AuthTitle from './components/auth-title.vue'
</script>

<template>
  <div class="flex items-center justify-center min-h-screen p-4 min-w-screen">
    <main class="flex flex-col gap-4">
      <AuthTitle />
      <Card class="w-full max-w-sm">
        <CardHeader>
          <CardTitle class="text-2xl">双因素认证</CardTitle>
          <CardDescription>该功能暂未开放。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button class="w-full" @click="$router.push('/auth/sign-in')">返回登录</Button>
        </CardContent>
      </Card>
    </main>
  </div>
</template>
