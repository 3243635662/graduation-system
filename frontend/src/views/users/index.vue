<script setup lang="ts">
/**
 * 用户管理 /users
 * 面向管理角色：学生、教师及管理员账号维护。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '账号列表：按角色、院系、状态筛选并分页',
  '账号维护：新增、编辑、停用与重置密码',
  '角色分配：为用户绑定一个或多个系统角色',
  '批量操作：批量导入、批量调整院系与角色',
]

const roles = ['超级管理员', '学校管理员', '院系管理员']
</script>

<template>
  <PageScaffold
    title="用户管理"
    description="维护学生、教师及管理员账号，并分配系统角色。"
    :features="features"
    :roles="roles"
  />
</template>
