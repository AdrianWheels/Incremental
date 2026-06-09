/* Motor genérico de mejoras: definición + coste geométrico.
 * Los selectores derivados (oroBase, sweetW…) son identidad de cada fase y viven en su *Phase.tsx. */

export type UpgradeDef = { name: string; base: number; growth: number; color: string }
export type Levels<K extends string = string> = Record<K, number>

export const costOf = (def: UpgradeDef, lv: number) => Math.floor(def.base * def.growth ** lv)
