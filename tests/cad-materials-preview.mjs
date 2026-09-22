import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// 隔离预览真实页面和 Viewer：仅替换 Nuxt 会话与 AI 返回，绝不访问账号、数据库或模型服务。
// Node 26：node tests/cad-materials-preview.mjs，然后在浏览器打开打印的地址。
// 加 --workspace 可在 4179 端口回归工作台分析结果转 3D 弹窗。
const workspace = process.argv.includes('--workspace')
const mocks = `
import { ref } from 'vue';
import { cadModelSchema, cadMaterialEditSchema, applyCadMaterialEdit } from '/server/utils/cad/schema.ts';
import { compactCadText } from '/server/utils/cad/compact.ts';
export const definePageMeta = () => {};
export const useAuth = () => ({ data: ref({ user: { name: '材质回归测试' } }), signOut: async () => {} });
const state = ref(null);
export const useState = () => state;
export const useRouter = () => ({ push: async () => { window.__cadTest.snapshot = state.value; } });
const fixture = { units: 'mm', title: '木纹 · 金属 · 玻璃', summary: '木质底板、黄铜支架与透明玻璃球', model: {
  kind: 'union', children: [
    { kind: 'subtract', material: { type: 'wood', color: '#b88752', grainAxis: 'x' }, children: [
      { kind: 'box', size: { w: 100, h: 8, d: 60 }, transform: { translate: [0, -15, 0] } },
      { kind: 'cylinder', size: { radius: 5, height: 14 }, transform: { translate: [-35, -15, 18] } }
    ] },
    { kind: 'cylinder', size: { radius: 8, height: 25 }, transform: { translate: [20, 0, 0] }, material: { type: 'metal', color: '#bd914c', finish: 'polished' } },
    { kind: 'sphere', size: { radius: 18 }, transform: { translate: [20, 28, 0] }, material: { type: 'glass', thickness: 6 } }
  ]
}};
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
const tasks = ['A', 'B'].map(id => ({
  id, name: '测试柜体 ' + id, status: 'COMPLETED', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  inputData: { userRequirement: '制作木质柜体', bucket: 'fixture', ossKey: id },
  outputData: {
    drawing_info: { title: '柜体 ' + id, type: '立面图', unit: 'mm' },
    elements: Array.from({ length: 12 }, (_, i) => ({ type: '板', description: id + ' 层板 ' + (i + 1), position: '中部', properties: { width: '600', height: '18', material: '胡桃木', thickness: '18' }, confidence: 'high' })),
    spaces: [{ name: '储物区 ' + id, position: '中部', estimated_area: '1㎡' }],
    dimensions: Array.from({ length: 10 }, (_, i) => ({ value: String(600 + i), target: '尺寸' + (i + 1) })),
    summary: '柜体分析 ' + id, suggestion: '保留木纹，增加金属支架', annotations: [{ text: '深度 400mm', type: 'note' }],
    resultImage: image, _meta: { totalTokens: 123 }, _quality: { ocrCoverage: '99%' },
    iterations: [{ userMessage: '暖色灯光', resultImage: image, createdAt: new Date().toISOString() }],
  },
}));
window.__cadTest = { requests: [], snapshot: null, nextResponse: null, nextError: null, delay: 200, tasks, compactions: [], compactReplies: [], generatedTexts: [] };
export async function $fetch(url, options) {
  const state = window.__cadTest;
  if (url === '/api/tasks') return { tasks: structuredClone(tasks) };
  if (url.startsWith('/api/tasks/')) return { task: structuredClone(tasks.find(task => task.id === url.split('/').pop())) };
  if (url.startsWith('/api/oss/presigned')) return { url: image };
  if (url !== '/api/cad/generate') throw new Error('隔离预览禁止访问其他接口：' + url);
  const body = structuredClone(JSON.parse(JSON.stringify(options.body)));
  state.requests.push(body);
  let model = state.nextResponse;
  const error = state.nextError;
  state.nextResponse = null;
  state.nextError = null;
  // 故意不消费 AbortSignal，以验证关闭重开后迟到的响应不会覆盖新结果。
  await new Promise(resolve => setTimeout(resolve, state.delay));
  if (error) throw new Error(error);
  const normalizedText = body.autoCompact && body.mode === 'generate'
    ? await compactCadText(body.text, async (prompt, system) => {
      state.compactions.push({ prompt, system });
      return { rawText: state.compactReplies.length ? state.compactReplies.shift() : '柜体600×2400×400mm，胡桃木层板与金属支架，保留原布局。' };
    }) : body.text;
  state.generatedTexts.push(normalizedText);
  if (!model && body.mode === 'material') {
    const text = body.text;
    let material = text.includes('玻璃') ? { type: 'glass', roughness: text.includes('磨砂') ? 0.4 : 0.06 }
      : text.includes('金属') || text.includes('不锈钢') ? { type: 'metal', finish: 'brushed' }
      : text.includes('石') ? { type: 'stone' }
      : { type: 'wood', color: '#68432b', grainAxis: 'x' };
    model = applyCadMaterialEdit(cadModelSchema.parse(body.currentModel), cadMaterialEditSchema.parse({ summary: '测试材质：' + material.type, changes: [{ path: [], material }] }));
  }
  model = cadModelSchema.parse(model || fixture);
  return { success: true, model, title: model.title, summary: model.summary, ...(normalizedText !== body.text ? { normalizedText } : {}) };
}
`
const entry = `
import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import Page from '/app/pages/${workspace ? 'workspace' : 'cad'}.vue';
import Viewer from '/app/components/cad/Viewer3D.client.vue';
const app = createApp(Page);
app.use(ElementPlus);
app.component('CadViewer3D', Viewer);
app.component('NuxtLink', { props: ['to'], template: '<a :href="to"><slot /></a>' });
app.mount('#app');
`
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>CAD 材质回归预览</title><style>body{margin:0;font-family:system-ui}</style></head><body><div id="app"></div><script type="module" src="/@cad-entry"></script></body></html>'
const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: false,
  server: { host: '127.0.0.1', port: workspace ? 4179 : 4178, strictPort: true },
  plugins: [
    {
      name: 'cad-isolated-preview',
      enforce: 'pre',
      resolveId(id) { if (['/@cad-entry', '/@cad-mocks'].includes(id)) return id },
      load(id) {
        if (id === '/@cad-entry') return entry
        if (id === '/@cad-mocks') return mocks
      },
      transform(source, id) {
        if (id.endsWith('/app/pages/cad.vue')) {
          return source.replace('<script setup lang="ts">', '<script setup lang="ts">\nimport { ref, computed, watch } from "vue";\nimport { ElMessage } from "element-plus";\nimport { definePageMeta, useAuth, useRouter, useState, $fetch } from "/@cad-mocks";')
        }
        if (id.endsWith('/app/pages/workspace.vue')) {
          return source.replace('<script setup lang="ts">', '<script setup lang="ts">\nimport { onMounted, onBeforeUnmount } from "vue";\nimport { ElMessage, ElMessageBox } from "element-plus";\nimport { definePageMeta, useAuth, useRouter, useState, $fetch } from "/@cad-mocks";')
        }
        if (id.endsWith('/app/components/cad/Viewer3D.client.vue')) {
          return source.replace('<script setup lang="ts">', '<script setup lang="ts">\nimport { ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";')
        }
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== '/') return next()
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(await server.transformIndexHtml('/', html))
        })
      },
    },
    vue(),
  ],
})
await server.listen()
server.printUrls()
