<script setup lang="ts">
/**
 * 我的选题 /topics/my
 * 面向学生：查看本人选题状态与结果。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '我的申请列表：展示已提交的选题申请及当前审核状态',
  '选题进度：已申请、待审核、已通过、已驳回的状态流转',
  '选题结果：确认最终课题与指导教师',
  '撤销申请与重新选题',
]

const roles = ['学生']
</script>

<template>
  <PageScaffold
    title="我的选题"
    description="学生查看个人选题申请、审核进度与最终选题结果。"
    :features="features"
    :roles="roles"
  />
</template>
