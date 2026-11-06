<script setup lang="ts">
/**
 * 组件注册表兜底页
 * 当菜单节点的 componentKey 在 src/views 中找不到对应文件时渲染该页，
 * 避免动态路由注册失败导致整个页面白屏。
 */
const route = useRoute()
</script>

<template>
  <div
    class="flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-10 text-center"
  >
    <p class="text-sm font-medium text-destructive">页面组件缺失</p>
    <p class="text-xs text-muted-foreground">
      路由 {{ route.path }} 未能在 src/views 中找到对应组件，请检查菜单的 componentKey 配置。
    </p>
  </div>
</template>
