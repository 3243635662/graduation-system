<script setup lang="ts">
/**
 * 角色管理 /roles
 * 面向管理角色：固定系统角色及其关联配置。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '角色列表：展示超级管理员、学校管理员、院系管理员、教师、学生',
  '角色信息：查看角色编码、名称与说明',
  '角色菜单：为角色分配可访问的菜单节点',
  '角色权限：为角色分配操作权限点',
]

const roles = ['超级管理员', '学校管理员']
</script>

<template>
  <PageScaffold
    title="角色管理"
    description="维护固定系统角色，并配置角色的菜单与权限关联。"
    :features="features"
    :roles="roles"
  />
</template>
