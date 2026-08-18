export interface EndpointStrategy {
  strategy: 'CUBE' | 'VERTEX' | 'MEAN' | 'XYZ'
  cube_name?: string
  vertex_index?: number
  vertex_indices?: number[]
  default_position: [number, number, number]
  offset?: [number, number, number]
}

export interface RuntimeBoneDefinition {
  head: EndpointStrategy
  tail: EndpointStrategy
  parent: string
  roll: number
}

export interface MakeHumanBaseData {
  schema: string
  scaleFactor: number
  bodyVertexCount: number
  fullPositions: number[]
  renderSource: number[]
  uv: number[]
  indices: number[]
  skinIndex: number[]
  skinWeight: number[]
  sourceSkinIndex: number[]
  sourceSkinWeight: number[]
  boneNames: string[]
  jointGroups: Record<string, number[]>
  rig: { version: number; scale_factor: number; bones: Record<string, RuntimeBoneDefinition> }
  source: { basemesh: string; license: string }
}

export interface SparseTarget {
  indices: Uint32Array
  delta: Float32Array
}

export interface WeightedTarget { path: string; weight: number }
