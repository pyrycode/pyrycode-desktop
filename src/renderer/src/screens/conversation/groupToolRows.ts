export interface GroupedToolRow {
  marker?: boolean
  background?: boolean
  relocated?: boolean
  index: number
  depth: number
  ancestors: number[]
  count: number
  hasChildren: boolean
  running: boolean
}
