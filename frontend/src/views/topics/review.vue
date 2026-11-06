<script setup lang="ts">
/**
 * 选题审核 /topics/review
 * 面向院系管理员与学校管理员：审核课题与选题申请。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '课题审核：审核教师提交的课题，通过或驳回并填写意见',
  '选题申请审核：按院系、专业、教师维度批量处理申请',
  '审核记录：查看历史审核意见与操作人',
  '审核统计：待审数量、通过率等基础指标',
]

const roles = ['超级管理员', '学校管理员', '院系管理员']
</script>

<template>
  <PageScaffold
    title="选题审核"
    description="院系与学校层面的课题审核、选题申请审核及审核记录查询。"
    :features="features"
    :roles="roles"
  />
</template>
