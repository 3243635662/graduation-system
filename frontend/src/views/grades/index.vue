<script setup lang="ts">
/**
 * 成绩管理 /grades
 * 面向管理角色：成绩录入、审核与查询。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '成绩录入：按指导教师评分、评阅成绩、答辩成绩合成总评',
  '成绩审核：院系与学校两级审核与退回',
  '成绩查询：按学生、课题、教师多维度检索',
  '成绩导出：导出成绩单与统计报表',
]

const roles = ['院系管理员', '学校管理员', '超级管理员']
</script>

<template>
  <PageScaffold
    title="成绩管理"
    description="毕业设计成绩的录入、审核、查询与导出。"
    :features="features"
    :roles="roles"
  />
</template>
