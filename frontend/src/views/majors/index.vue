<script setup lang="ts">
/**
 * 专业管理 /majors
 * 面向管理角色：专业信息及其所属院系维护。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '专业列表：按院系筛选展示专业信息',
  '专业维护：新增、编辑、停用专业',
  '归属配置：设置专业所属院系与学制',
]

const roles = ['超级管理员', '学校管理员', '院系管理员']
</script>

<template>
  <PageScaffold
    title="专业管理"
    description="维护专业基础信息，并配置专业所属院系与学制。"
    :features="features"
    :roles="roles"
  />
</template>
