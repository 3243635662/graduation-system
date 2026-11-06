<script setup lang="ts">
/**
 * 论文评阅 /thesis/review
 * 面向教师：评阅论文并填写评语与成绩建议。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '待评列表：按批次、院系、评阅状态筛选论文',
  '论文预览：在线查看论文内容与附件',
  '评阅表单：填写评分项、评语与修改建议',
  '评阅记录：查看已提交评阅结果与进度',
]

const roles = ['指导教师', '院系管理员']
</script>

<template>
  <PageScaffold
    title="论文评阅"
    description="教师在线评阅毕业论文，填写评分项、评语与修改建议。"
    :features="features"
    :roles="roles"
  />
</template>
