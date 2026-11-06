<script setup lang="ts">
/**
 * 菜单管理 /menus
 * 面向超级管理员：菜单树、排序与可见性管理。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '菜单树：以树形结构展示 DIRECTORY 与 PAGE 节点',
  '菜单维护：新增、编辑、删除菜单节点',
  '排序与可见性：调整同级顺序、控制显示与启用状态',
  '组件绑定：为 PAGE 节点配置 componentKey 与路由 path',
]

const roles = ['超级管理员']
</script>

<template>
  <PageScaffold
    title="菜单管理"
    description="维护系统菜单树、排序、可见性及页面组件绑定关系。"
    :features="features"
    :roles="roles"
  />
</template>
