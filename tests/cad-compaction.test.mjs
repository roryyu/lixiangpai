import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { compactCadText, MAX_CAD_ANALYSIS_LENGTH } from '../server/utils/cad/compact.ts'

const longText = '柜体尺寸600×2400×400mm，胡桃木，保留顶部层板。'.repeat(600)
const brief = '柜体600×2400×400mm；胡桃木；保留顶部层板。'

test('不超过12000字时不调用精简模型，原样保留分析', async () => {
  for (const text of ['', brief, '木'.repeat(12000)]) {
    assert.equal(await compactCadText(text, () => assert.fail('不应精简')), text)
  }
})

test('超长内容自动精简，提示词保留尺寸关联、单位、布局和材质约束', async () => {
  let calls = 0
  const result = await compactCadText(longText, async (prompt, system) => {
    calls++
    assert.ok(prompt.endsWith(longText))
    for (const keyword of ['单位', '连接关系', '材质', '修改建议', '尺寸必须关联', '不得新增或改写尺寸']) {
      assert.ok(system.includes(keyword))
    }
    return { rawText: `  ${brief}\n` }
  })
  assert.equal(result, brief)
  assert.equal(calls, 1)
})

test('精简结果恰好12000字仍自动重试，不能硬截内容', async () => {
  const intermediate = '尺寸'.repeat(6000)
  let calls = 0
  assert.equal(await compactCadText(longText, async prompt => {
    calls++
    if (calls === 1) return { rawText: intermediate }
    assert.ok(prompt.endsWith(intermediate))
    return { rawText: brief }
  }), brief)
  assert.equal(calls, 2)
})

test('空返回和临时调用异常自动重试，第三次可以恢复', async () => {
  let calls = 0
  assert.equal(await compactCadText(longText, async () => {
    calls++
    if (calls === 1) return { rawText: '   ' }
    if (calls === 2) throw new Error('服务暂时不可用')
    return { rawText: brief }
  }), brief)
  assert.equal(calls, 3)
})

test('持续超长或空返回仅重试三次，不将无效摘要交给建模', async () => {
  for (const rawText of [' '.repeat(5), '字'.repeat(12000)]) {
    let calls = 0
    await assert.rejects(compactCadText(longText, async () => { calls++; return { rawText } }), /自动精简失败.*无需手动/)
    assert.equal(calls, 3)
  }
})

test('大量分析完整分段，分段预算包含分隔符，最终严格少于12000字', async () => {
  const text = '甲'.repeat(23999) + '🪵' + '\n' + '乙'.repeat(24000) + '\n' + '丙'.repeat(30000)
  const segments = []
  const result = await compactCadText(text, async prompt => {
    const segment = prompt.split('待精简分析：\n')[1]
    segments.push(segment)
    assert.ok(segment.length <= 24000)
    assert.ok(segment.isWellFormed())
    const limit = Number(prompt.match(/硬性上限 (\d+) 字/)[1])
    return { rawText: '木'.repeat(limit) }
  })
  assert.equal(segments.join(''), text)
  assert.ok(segments.length > 1)
  assert.ok(result.length < 12000)
  assert.ok(result.length > 11990)
})

test('超出原始输入安全上限时不调用模型', async () => {
  await assert.rejects(compactCadText('木'.repeat(MAX_CAD_ANALYSIS_LENGTH + 1), () => assert.fail('不能调用模型')), /自动处理上限/)
})

// 加载真实 API handler，仅替换模型网络请求和鉴权，验证精简→建模的实际接线。
const state = { calls: [], images: [], replies: [], user: { id: 'test-user' } }
globalThis.__cadCompactionTest = state
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/api/cad/generate.post.ts')) {
      if (specifier.endsWith('/recognition/qwen')) return { url: 'cad-test:qwen', shortCircuit: true }
      if (specifier.endsWith('/utils/auth')) return { url: 'cad-test:auth', shortCircuit: true }
    }
    try { return nextResolve(specifier, context) }
    catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context)
      }
      throw error
    }
  },
  load(url, context, nextLoad) {
    if (url === 'cad-test:auth') return { format: 'module', shortCircuit: true, source: 'export const getUserFromToken = () => globalThis.__cadCompactionTest.user' }
    if (url === 'cad-test:qwen') return { format: 'module', shortCircuit: true, source: `
      const state = globalThis.__cadCompactionTest;
      export async function callQwenDoc(prompt, system) {
        state.calls.push({ prompt, system });
        const reply = state.replies.shift();
        if (reply instanceof Error) throw reply;
        return { rawText: reply || '' };
      }
      export const parseQwenJson = text => { try { return JSON.parse(text) } catch { return null } };
      export const createQwenClient = () => ({ chat: { completions: { create: async input => {
        state.images.push(input);
        return { choices: [{ message: { content: state.replies.shift() } }] };
      } } } });
    ` }
    return nextLoad(url, context)
  },
})

test('真实生成接口自动精简的集成验证', async t => {
  const originals = Object.fromEntries(['defineEventHandler', 'readBody', 'createError'].map(key => [key, globalThis[key]]))
  globalThis.defineEventHandler = handler => handler
  globalThis.readBody = async event => event.body
  globalThis.createError = options => Object.assign(new Error(options.message), options)
  const model = JSON.stringify({ units: 'mm', title: '木柜', model: { kind: 'box', size: { w: 600, h: 2400, d: 400 } } })
  try {
    const { default: handler } = await import('../server/api/cad/generate.post.ts')
    const reset = replies => { state.calls = []; state.images = []; state.replies = replies; state.user = { id: 'test-user' } }

    await t.test('超长启用自动精简：先摘要后建模，并返回实际使用的精简文本', async () => {
      reset([brief, model])
      const result = await handler({ body: { text: longText, autoCompact: true } })
      assert.equal(result.success, true)
      assert.equal(result.normalizedText, brief)
      assert.equal(state.calls.length, 2)
      assert.match(state.calls[0].system, /精简助手/)
      assert.ok(state.calls[1].prompt.endsWith(brief))
      assert.ok(!state.calls[1].prompt.includes(longText))
    })

    await t.test('普通输入只调用一次建模，保留既有API行为', async () => {
      reset([model])
      const result = await handler({ body: { text: brief, autoCompact: true } })
      assert.equal(result.success, true)
      assert.equal(result.normalizedText, undefined)
      assert.equal(state.calls.length, 1)
      assert.match(state.calls[0].system, /CSG/)
    })

    await t.test('精简失败后不调用建模模型，返回可重试错误', async () => {
      reset(['', '', ''])
      await assert.rejects(handler({ body: { text: longText, autoCompact: true } }), error => error.statusCode === 502 && /自动精简失败/.test(error.message))
      assert.equal(state.calls.length, 3)
      assert.ok(state.calls.every(call => call.system.includes('精简助手')))
    })

    await t.test('未启用精简、非法模式和超大输入仍在模型调用前拒绝', async () => {
      for (const body of [
        { text: longText },
        { text: longText, autoCompact: 'true' },
        { text: longText, autoCompact: true, mode: 'material' },
        { text: '字'.repeat(MAX_CAD_ANALYSIS_LENGTH + 1), autoCompact: true },
      ]) {
        reset([])
        await assert.rejects(handler({ body }), error => error.statusCode === 400)
        assert.equal(state.calls.length, 0)
      }
    })

    await t.test('附带图片时，精简后的文本交给视觉模型，图片保持不变', async () => {
      reset([brief, model])
      const result = await handler({ body: { text: longText, autoCompact: true, imageBase64: 'test-image', mediaType: 'image/png' } })
      assert.equal(result.success, true)
      assert.equal(state.calls.length, 1)
      assert.equal(state.images.length, 1)
      const content = state.images[0].messages[1].content
      assert.equal(content[0].image_url.url, 'data:image/png;base64,test-image')
      assert.ok(content[1].text.endsWith(brief))
    })

    await t.test('未登录时不执行精简或生成', async () => {
      reset([])
      state.user = null
      await assert.rejects(handler({ body: { text: longText, autoCompact: true } }), error => error.statusCode === 401)
      assert.equal(state.calls.length, 0)
    })
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
    delete globalThis.__cadCompactionTest
  }
})
