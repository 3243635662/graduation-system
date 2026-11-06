<script setup lang="ts">
/**
 * 答辩管理 /defense
 * 面向教师与管理角色：组织答辩安排。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '答辩安排：设置时间、地点、分组与答辩委员会成员',
  '学生分组：按课题方向或院系分配答辩小组',
  '答辩记录：录入答辩过程、提问与结论',
  '答辩结果：生成答辩成绩并同步至成绩管理',
]

const roles = ['指导教师', '院系管理员', '学校管理员', '超级管理员']
</script>

<template>
  <PageScaffold
    title="答辩管理"
    description="组织毕业设计答辩，管理时间、地点、分组、成员与答辩结果。"
    :features="features"
    :roles="roles"
  />
</template>
