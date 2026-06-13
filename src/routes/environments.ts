// Lab (multi-model comparison) routes have moved to lab.ts (/api/lab/*).
// This stub keeps existing imports in index.ts valid during transition.
import type { Handler } from '../lib/http'

export const environmentRoutes: Array<[string, string, Handler]> = []
