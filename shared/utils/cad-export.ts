import type { BufferGeometry } from 'three'

export const MAX_CAD_EXPORT_TRIANGLES = 100_000
export const CAD_EXPORT_UNITS = { mm: 4, cm: 5, m: 6, in: 1, inch: 1, ft: 2 } as const
export type CadExportUnit = keyof typeof CAD_EXPORT_UNITS

function isCadExportUnit(units: string): units is CadExportUnit {
  return Object.hasOwn(CAD_EXPORT_UNITS, units)
}

/** 读取布尔求值后的有效三角面，忽略相机和预览居中位移。 */
export function geometryToTriangles(geometry: BufferGeometry): number[] {
  const position = geometry.getAttribute('position')
  if (!position || position.itemSize < 3) throw new Error('模型没有可导出的顶点')
  const index = geometry.getIndex()
  const available = index ? index.count : position.count
  const start = geometry.drawRange.start
  const count = Math.min(geometry.drawRange.count, available - start)
  if (!Number.isInteger(start) || start < 0 || start % 3 !== 0 ||
      !Number.isInteger(count) || count <= 0 || count % 3 !== 0) {
    throw new Error('模型三角网格无效或为空')
  }
  if (count / 3 > MAX_CAD_EXPORT_TRIANGLES) throw new Error('模型超过 10 万个三角面，请简化后导出')

  const triangles: number[] = []
  for (let i = start; i < start + count; i++) {
    const vertex = index ? index.getX(i) : i
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) {
      throw new Error('模型顶点索引无效')
    }
    const point = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
    if (point.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) {
      throw new Error('模型包含无效或超出范围的坐标')
    }
    triangles.push(...point)
  }
  return triangles
}

/** 生成仅含 3DFACE 的 R2000 三维 DXF，浏览器直接下载，可用 AutoCAD 打开，无需外部转换器。 */
export function trianglesToDxf(triangles: readonly number[], units: string): string {
  if (!triangles.length || triangles.length % 9 !== 0 ||
      triangles.length > MAX_CAD_EXPORT_TRIANGLES * 9 ||
      triangles.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) {
    throw new Error('无效的三角网格数据')
  }
  units = units.trim().toLowerCase()
  if (!isCadExportUnit(units)) throw new Error('不支持的模型单位，请使用 mm/cm/m/in/inch/ft')

  const minimum: [number, number, number] = [Infinity, Infinity, Infinity]
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < triangles.length; i += 3) {
    const coordinates = [triangles[i]!, -triangles[i + 2]!, triangles[i + 1]!]
    for (const axis of [0, 1, 2] as const) {
      minimum[axis] = Math.min(minimum[axis], coordinates[axis]!)
      maximum[axis] = Math.max(maximum[axis], coordinates[axis]!)
    }
  }

  const lines: string[] = []
  const pair = (code: number, value: string | number) => { lines.push(String(code), String(value)) }
  const point = (code: number, x: number, y: number, z: number) => {
    pair(code, x); pair(code + 10, y); pair(code + 20, z)
  }
  const section = (name: string) => { pair(0, 'SECTION'); pair(2, name) }
  const record = (type: string, handle: string, owner: string, subclass: string) => {
    pair(0, type); pair(5, handle); pair(330, owner)
    pair(100, 'AcDbSymbolTableRecord'); pair(100, subclass)
  }
  const table = (name: string, handle: string, count: number) => {
    pair(0, 'TABLE'); pair(2, name); pair(5, handle)
    pair(100, 'AcDbSymbolTable'); pair(70, count)
  }

  section('HEADER')
  pair(9, '$ACADVER'); pair(1, 'AC1015')
  pair(9, '$HANDSEED'); pair(5, (0x10 + triangles.length / 9).toString(16).toUpperCase())
  pair(9, '$INSUNITS'); pair(70, CAD_EXPORT_UNITS[units])
  pair(9, '$MEASUREMENT'); pair(70, CAD_EXPORT_UNITS[units] <= 2 ? 0 : 1)
  pair(9, '$INSBASE'); point(10, 0, 0, 0)
  pair(9, '$EXTMIN'); point(10, ...minimum)
  pair(9, '$EXTMAX'); point(10, ...maximum)
  pair(0, 'ENDSEC')

  section('TABLES')
  table('LTYPE', '1', 1)
  record('LTYPE', '2', '1', 'AcDbLinetypeTableRecord')
  pair(2, 'CONTINUOUS'); pair(70, 0); pair(3, 'Solid line')
  pair(72, 65); pair(73, 0); pair(40, 0)
  pair(0, 'ENDTAB')
  table('LAYER', '3', 1)
  record('LAYER', '4', '3', 'AcDbLayerTableRecord')
  pair(2, '0'); pair(70, 0); pair(62, 7); pair(6, 'CONTINUOUS')
  pair(0, 'ENDTAB')
  table('BLOCK_RECORD', '5', 2)
  record('BLOCK_RECORD', '6', '5', 'AcDbBlockTableRecord'); pair(2, '*Model_Space')
  record('BLOCK_RECORD', '7', '5', 'AcDbBlockTableRecord'); pair(2, '*Paper_Space')
  pair(0, 'ENDTAB')
  pair(0, 'ENDSEC')

  section('BLOCKS')
  for (const [name, owner, begin, end] of [
    ['*Model_Space', '6', '8', '9'], ['*Paper_Space', '7', 'A', 'B'],
  ] as const) {
    pair(0, 'BLOCK'); pair(5, begin); pair(330, owner)
    pair(100, 'AcDbEntity'); pair(8, '0'); pair(100, 'AcDbBlockBegin')
    pair(2, name); pair(70, 0); point(10, 0, 0, 0); pair(3, name); pair(1, '')
    pair(0, 'ENDBLK'); pair(5, end); pair(330, owner)
    pair(100, 'AcDbEntity'); pair(8, '0'); pair(100, 'AcDbBlockEnd')
  }
  pair(0, 'ENDSEC')

  section('ENTITIES')
  for (let i = 0; i < triangles.length; i += 9) {
    pair(0, '3DFACE'); pair(5, (0x10 + i / 9).toString(16).toUpperCase()); pair(330, '6')
    pair(100, 'AcDbEntity'); pair(8, '0'); pair(100, 'AcDbFace')
    for (let corner = 0; corner < 4; corner++) {
      const offset = i + Math.min(corner, 2) * 3
      // Three.js Y 向上转换为 CAD Z 向上：(x, y, z) → (x, -z, y)。
      point(10 + corner, triangles[offset]!, -triangles[offset + 2]!, triangles[offset + 1]!)
    }
    pair(70, 0)
  }
  pair(0, 'ENDSEC'); pair(0, 'EOF')
  return lines.join('\r\n') + '\r\n'
}
