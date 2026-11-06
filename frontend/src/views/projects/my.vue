<script setup lang="ts">
/**
 * 我的毕设 /projects/my
 * 面向学生：个人毕设项目、任务与阶段进度。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '项目概览：课题信息、指导教师、起止时间',
  '阶段进度：开题、中期、论文、答辩各阶段完成情况',
  '任务清单：查看教师布置的任务并提交成果',
  '材料管理：查看本人已提交的过程材料与反馈',
]

const roles = ['学生']
</script>

<template>
  <PageScaffold
    title="我的毕设"
    description="学生个人毕业设计项目主页，聚合任务、阶段进度与过程材料。"
    :features="features"
    :roles="roles"
  />
</template>
