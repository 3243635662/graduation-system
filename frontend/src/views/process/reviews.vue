<script setup lang="ts">
/**
 * 过程材料审核 /process/reviews
 * 面向教师与管理角色：审核开题、中期、论文等过程材料。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '待审列表：按材料类型、院系、指导教师筛选待审材料',
  '材料详情：在线查看附件与版本历史',
  '审核操作：通过、驳回并填写审核意见',
  '审核记录：查询已处理材料与历史意见',
]

const roles = ['指导教师', '院系管理员', '学校管理员', '超级管理员']
</script>

<template>
  <PageScaffold
    title="过程材料审核"
    description="统一处理开题报告、中期检查、论文等过程材料的审核工作。"
    :features="features"
    :roles="roles"
  />
</template>
