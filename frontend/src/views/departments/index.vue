<script setup lang="ts">
/**
 * 院系管理 /departments
 * 面向管理角色：院系信息维护。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '院系列表：展示院系名称、编码与负责人',
  '院系维护：新增、编辑、停用院系',
  '层级关系：维护学校与院系的从属关系',
]

const roles = ['超级管理员', '学校管理员']
</script>

<template>
  <PageScaffold
    title="院系管理"
    description="维护学校院系基础信息及其层级关系。"
    :features="features"
    :roles="roles"
  />
</template>
