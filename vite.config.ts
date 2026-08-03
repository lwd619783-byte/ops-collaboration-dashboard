import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { parseSupabaseConfig } from './src/lib/supabase/config-validation'

function environmentWithProcessPriority(
  fileEnvironment: Record<string, string>,
) {
  const environment: Record<string, string | undefined> = {
    ...fileEnvironment,
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value
  }

  return environment
}

export default defineConfig(({ command, mode }) => {
  const environment = environmentWithProcessPriority(
    loadEnv(mode, process.cwd(), ''),
  )
  const validation = parseSupabaseConfig(environment, {
    isDevelopment: command === 'serve' && mode !== 'production',
  })

  if (validation.status === 'invalid') {
    throw new Error(validation.message)
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/tests/setup.ts',
      css: true,
    },
  }
})
