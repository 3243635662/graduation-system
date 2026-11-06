<script setup lang="ts">
import Loading from '@/components/loading.vue'
import { useRouter } from 'vue-router'

// 首页统一进入工作台（工作台由动态路由注册，路径固定为 /dashboard）
const router = useRouter()
router.replace('/dashboard')
</script>

<template>
  <div class="flex items-center justify-center w-screen h-screen">
    <Loading />
  </div>
</template>

<route lang="yaml">
meta:
  layout: false
</route>
