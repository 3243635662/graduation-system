<script setup lang="ts">
/**
 * AI 助手 /ai-assistant
 * 面向全部角色：对话式智能辅助。
 */
import PageScaffold from '@/views/_shared/page-scaffold.vue'

const features = [
  'AI 对话：多轮问答与会话历史管理',
  '选题辅助：根据方向与兴趣推荐课题思路',
  '文献辅助：文献检索建议、摘要与综述提纲生成',
  '写作辅助：论文结构、措辞与格式优化建议',
]

const roles = ['超级管理员', '学校管理员', '院系管理员', '指导教师', '学生']
</script>

<template>
  <PageScaffold
    title="AI 助手"
    description="面向毕设全流程的智能对话入口，提供选题、文献与写作辅助。"
    :features="features"
    :roles="roles"
  />
</template>
