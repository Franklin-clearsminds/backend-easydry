import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/** Orquestador de las pruebas de la web contra el backend real (ver test/integracion/web). */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/integracion/web/ejecutar-pruebas-web.ts'],
    testTimeout: 25 * 60_000,
    hookTimeout: 120_000,
  },
});
