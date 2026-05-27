declare module "d3-force-3d" {
  export function forceCollide<NodeDatum>(
    radius?: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number)
  ): unknown;
}
