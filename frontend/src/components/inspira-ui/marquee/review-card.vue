<script setup lang="ts">
interface Props {
  img: string
  name: string
  username: string
  body: string
}

defineProps<Props>()
</script>

<template>
  <figure
    class="relative w-64 cursor-pointer overflow-hidden rounded-xl border border-border bg-card/60 p-4 hover:bg-card/80"
  >
    <div class="flex flex-row items-center gap-2">
      <img :src="img" class="rounded-full" width="32" height="32" alt="" />
      <div class="flex flex-col">
        <span class="text-sm font-medium text-card-foreground">
          {{ name }}
        </span>
        <p class="text-xs font-medium text-muted-foreground">
          {{ username }}
        </p>
      </div>
    </div>
    <blockquote class="mt-2 text-sm">
      {{ body }}
    </blockquote>
  </figure>
</template>
