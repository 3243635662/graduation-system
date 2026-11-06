<script setup lang="ts">
/**
 * 指导学生 /projects/guidance
 * 面向指导教师：管理名下学生并记录指导过程。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '学生列表：查看本人指导的学生及其课题与进度',
  '指导记录：新增指导日志，记录时间、内容与结论',
  '任务布置：为学生下发阶段性任务并跟踪完成情况',
  '材料批阅：查看学生提交的过程材料并给出意见',
]

const roles = ['指导教师', '院系管理员']
</script>

<template>
  <PageScaffold
    title="指导学生"
    description="指导教师管理名下学生、记录指导过程并跟踪任务完成情况。"
    :features="features"
    :roles="roles"
  />
</template>
