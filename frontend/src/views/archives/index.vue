<script setup lang="ts">
/**
 * 成果归档 /archives
 * 面向管理角色：毕业成果与资料的最终归档。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  '归档清单：按学年、院系汇总需归档的成果材料',
  '材料归集：最终论文、过程材料、答辩记录统一归集',
  '归档审核：核对材料完整性并标记归档状态',
  '成果检索：按学生或课题查询历史归档记录',
]

const roles = ['院系管理员', '学校管理员', '超级管理员']
</script>

<template>
  <PageScaffold
    title="成果归档"
    description="毕业设计最终成果与过程资料的归档、核对与检索。"
    :features="features"
    :roles="roles"
  />
</template>
