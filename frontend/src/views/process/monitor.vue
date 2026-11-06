<script setup lang="ts">
/**
 * 进度监控 /process/monitor
 * 面向院系与学校：掌握整体毕设进度与异常情况。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '进度看板：各阶段完成率、院系与专业维度对比',
  '预警列表：超期未提交、审核驳回等异常记录',
  '学生明细：下钻查看单个学生的阶段状态',
  '数据导出：导出进度统计用于汇报',
]

const roles = ['院系管理员', '学校管理员', '超级管理员']
</script>

<template>
  <PageScaffold
    title="进度监控"
    description="院系与学校层面查看毕业设计整体进度，识别超期与异常情况。"
    :features="features"
    :roles="roles"
  />
</template>
