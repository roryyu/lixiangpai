import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute } from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { geometryToTriangles, trianglesToDxf, MAX_CAD_EXPORT_TRIANGLES, CAD_EXPORT_UNITS } from '../shared/utils/cad-export.ts'

const triangle = [1, 2, 3, 4, 5, 6, 7, 8, 9]

function geometry(values = triangle) {
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(values, 3))
}

function pairs(dxf) {
  const lines = dxf.trimEnd().split('\r\n')
  return Array.from({ length: lines.length / 2 }, (_, i) => [Number(lines[i * 2]), lines[i * 2 + 1]])
}

test('索引立方体导出 12 个三角面并保留真实尺寸', () => {
  const box = new BoxGeometry(60, 40, 8)
  const values = geometryToTriangles(box)
  assert.equal(values.length, 12 * 9)
  for (const [axis, half] of [[0, 30], [1, 20], [2, 4]]) {
    const coordinates = values.filter((_, i) => i % 3 === axis)
    assert.equal(Math.min(...coordinates), -half)
    assert.equal(Math.max(...coordinates), half)
  }
  box.dispose()
})

test('支持非索引、有效 drawRange 和建模平移', () => {
  const mesh = geometry([...triangle, ...triangle])
  mesh.translate(10, 0, 0)
  mesh.setDrawRange(3, 3)
  assert.deepEqual(geometryToTriangles(mesh), [11, 2, 3, 14, 5, 6, 17, 8, 9])
})

test('拒绝空网格、坏索引、非有限坐标和不完整三角形', () => {
  assert.throws(() => geometryToTriangles(new BufferGeometry()))
  assert.throws(() => geometryToTriangles(geometry([0, 1, 2])))
  assert.throws(() => geometryToTriangles(geometry([Infinity, ...triangle.slice(1)])))
  const invalid = geometry().setIndex([0, 1, 99])
  assert.throws(() => geometryToTriangles(invalid))
})

test('拒绝超过三角面上限的模型', () => {
  const values = new Float32Array((MAX_CAD_EXPORT_TRIANGLES + 1) * 9)
  const mesh = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(values, 3))
  assert.throws(() => geometryToTriangles(mesh), /10 万/)
})

test('DXF 包含单位和正确的 Z 向上坐标，三角形第四点重复第三点', () => {
  const entries = pairs(trianglesToDxf(triangle, 'mm'))
  const units = entries.findIndex(([code, value]) => code === 9 && value === '$INSUNITS')
  assert.deepEqual(entries[units + 1], [70, '4'])
  const faceStart = entries.findIndex(([code, value]) => code === 0 && value === '3DFACE')
  const face = entries.slice(faceStart + 1)
  const value = code => Number(face.find(([key]) => key === code)[1])
  assert.deepEqual([value(10), value(20), value(30)], [1, -3, 2])
  assert.deepEqual([value(12), value(22), value(32)], [7, -9, 8])
  assert.deepEqual([value(13), value(23), value(33)], [7, -9, 8])
  assert.deepEqual(entries.at(-1), [0, 'EOF'])
  assert.match(trianglesToDxf(triangle, 'in'), /\$INSUNITS\r\n70\r\n1\r\n/)
})

test('DXF 仅输出指定三角面且句柄不重复', () => {
  const entries = pairs(trianglesToDxf([...triangle, ...triangle], 'cm'))
  assert.equal(entries.filter(([code, value]) => code === 0 && value === '3DFACE').length, 2)
  const handles = entries.filter(([code]) => code === 5).map(([, value]) => value)
  assert.equal(new Set(handles).size, handles.length)
})

test('DXF 拒绝无效单位及坐标，不静默更改模型单位', () => {
  assert.throws(() => trianglesToDxf(triangle, 'unknown'))
  assert.throws(() => trianglesToDxf([], 'mm'))
  assert.throws(() => trianglesToDxf([NaN, ...triangle.slice(1)], 'mm'))
})

test('DXF 支持全部单位及大小写规范化，拒绝原型属性名', () => {
  for (const [unit, code] of Object.entries(CAD_EXPORT_UNITS)) {
    const entries = pairs(trianglesToDxf(triangle, ` ${unit.toUpperCase()} `))
    const units = entries.findIndex(([key, value]) => key === 9 && value === '$INSUNITS')
    assert.deepEqual(entries[units + 1], [70, String(code)])
  }
  assert.throws(() => trianglesToDxf(triangle, '__proto__'))
  assert.throws(() => trianglesToDxf(triangle, 'constructor'))
})

test('DXF 范围保留建模位置与尺寸，并转换为 Z 向上', () => {
  const box = new BoxGeometry(60, 40, 8).translate(100, 200, 300)
  const entries = pairs(trianglesToDxf(geometryToTriangles(box), 'mm'))
  const headerPoint = name => {
    const start = entries.findIndex(([code, value]) => code === 9 && value === name)
    return entries.slice(start + 1, start + 4).map(([, value]) => Number(value))
  }
  assert.deepEqual(headerPoint('$EXTMIN'), [70, -304, 180])
  assert.deepEqual(headerPoint('$EXTMAX'), [130, -296, 220])
  box.dispose()
})

test('索引网格遵守 drawRange，不导出缓冲区尾部数据', () => {
  const mesh = geometry([...triangle, ...triangle.map(value => value + 10)])
  mesh.setIndex([3, 4, 5, 0, 1, 2])
  mesh.setDrawRange(3, 3)
  assert.deepEqual(geometryToTriangles(mesh), triangle)
  mesh.setDrawRange(1, 3)
  assert.throws(() => geometryToTriangles(mesh))
  mesh.setDrawRange(0, 0)
  assert.throws(() => geometryToTriangles(mesh))
  mesh.dispose()
})

test('真实 CSG 差集的所有有效三角面可往返 DXF 坐标', () => {
  const box = new Brush(new BoxGeometry(20, 10, 20))
  const hole = new Brush(new CylinderGeometry(2, 2, 20, 16))
  box.updateMatrixWorld()
  hole.updateMatrixWorld()
  const result = new Evaluator().evaluate(box, hole, SUBTRACTION)
  const values = geometryToTriangles(result.geometry)
  assert.ok(values.length > 12 * 9)
  const entries = pairs(trianglesToDxf(values, 'mm'))
  const restored = []
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][0] !== 0 || entries[i][1] !== '3DFACE') continue
    const face = new Map()
    for (let j = i + 1; j < entries.length && entries[j][0] !== 0; j++) {
      face.set(entries[j][0], entries[j][1])
    }
    for (let vertex = 0; vertex < 3; vertex++) {
      restored.push(Number(face.get(10 + vertex)), Number(face.get(30 + vertex)), -Number(face.get(20 + vertex)) || 0)
    }
  }
  assert.deepEqual(restored, values.map(value => value || 0))
  box.geometry.dispose()
  hole.geometry.dispose()
  result.geometry.dispose()
})

test('浏览器下载封装产出合法的 DXF 头尾与 MIME', () => {
  const box = new BoxGeometry(10, 20, 30)
  const dxf = trianglesToDxf(geometryToTriangles(box), 'mm')
  assert.match(dxf, /^0\r\nSECTION\r\n2\r\nHEADER/)
  assert.match(dxf, /\r\n0\r\nEOF\r\n$/)
  assert.equal(new Blob([dxf], { type: 'image/vnd.dxf' }).type, 'image/vnd.dxf')
  box.dispose()
})
