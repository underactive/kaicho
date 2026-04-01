<script setup lang="ts">
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
      <router-link to="/" class="flex items-center gap-2 hover:opacity-80">
        <span class="text-lg font-bold tracking-tight">Kaicho</span>
        <span class="text-xs text-zinc-500 font-mono">dashboard</span>
      </router-link>
      <nav class="flex gap-4 text-sm">
        <router-link to="/" class="text-zinc-400 hover:text-white transition-colors" active-class="text-white">
          Sweeps
        </router-link>
        <router-link to="/runs" class="text-zinc-400 hover:text-white transition-colors" active-class="text-white">
          Runs
        </router-link>
      </nav>
    </header>
    <main class="max-w-6xl mx-auto px-6 py-6">
      <router-view />
    </main>
  </div>
</template>
