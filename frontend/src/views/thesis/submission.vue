<script setup lang="ts">
/**
 * 论文提交 /thesis/submission
 * 面向学生：上传毕业论文并管理版本。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '论文上传：支持格式校验、大小限制与查重前检查',
  '版本管理：保留多次提交记录，标识最终版本',
  '提交状态：展示待审核、已通过、需修改等状态',
  '审核意见：查看指导教师与评阅教师的修改建议',
]

const roles = ['学生']
</script>

<template>
  <PageScaffold
    title="论文提交"
    description="学生上传毕业论文、管理提交版本并跟踪审核状态。"
    :features="features"
    :roles="roles"
  />
</template>
