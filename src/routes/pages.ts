import type { Handler } from '../lib/http'
import { appPage } from './pages/appPage'
import { appsGallery } from './pages/appsGallery'
import { chat } from './pages/chatPage'
import { dashboard } from './pages/dashboard'
import { buildIndex, buildFile } from './pages/serve'
import { envPage } from './pages/envPage'
import { envsGallery } from './pages/envsGallery'

export const pageRoutes: Array<[string, string, Handler]> = [
  ['GET', '/',                    chat],
  ['GET', '/dashboard',           dashboard],
  ['GET', '/vibe',                (_req, _env) => Promise.resolve(new Response(null, { status: 301, headers: { Location: '/vibe.html' } }))],
  ['GET', '/tools',               (_req, _env) => Promise.resolve(new Response(null, { status: 301, headers: { Location: '/tools.html' } }))],
  ['GET', '/app/:id',             appPage],
  ['GET', '/apps',                appsGallery],
  ['GET', '/env/:id',             envPage],
  ['GET', '/environments',        envsGallery],
  ['GET', '/build/:id/:filename', buildFile],
  ['GET', '/build/:id',           buildIndex],
]
