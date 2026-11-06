<script setup lang="ts">
/**
 * 课题中心 /topics
 * 面向全部角色：浏览、检索毕业设计课题，查看课题详情。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '课题列表：按院系、专业、教师、年份筛选并分页展示',
  '关键词搜索：支持题目、研究方向、指导教师检索',
  '课题详情：查看课题简介、能力要求、可选人数与当前报名情况',
  '学生入口：从课题详情发起选题申请',
]

const roles = ['超级管理员', '学校管理员', '院系管理员', '指导教师', '学生']
</script>

<template>
  <PageScaffold
    title="课题中心"
    description="浏览与检索全校毕业设计课题，作为学生选题与教师发布课题的统一入口。"
    :features="features"
    :roles="roles"
  />
</template>
