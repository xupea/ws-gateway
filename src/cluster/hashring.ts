import { createHash } from 'crypto';

function hash(key: string): number {
  const hex = createHash('md5').update(key).digest('hex').slice(0, 8);
  return parseInt(hex, 16);
}

interface VirtualNode {
  pos: number;
  nodeId: string;
}

export class ConsistentHashRing {
  private ring: VirtualNode[] = [];
  private readonly virtualNodes: number;

  constructor(virtualNodes = 150) {
    this.virtualNodes = virtualNodes;
  }

  addNode(nodeId: string): void {
    for (let i = 0; i < this.virtualNodes; i++) {
      const pos = hash(`${nodeId}#${i}`);
      this.ring.push({ pos, nodeId });
    }
    this.ring.sort((a, b) => a.pos - b.pos);
  }

  removeNode(nodeId: string): void {
    this.ring = this.ring.filter((v) => v.nodeId !== nodeId);
  }

  /**
   * 返回 key 对应的节点 ID，环为空时返回 null
   */
  getNode(key: string): string | null {
    if (this.ring.length === 0) return null;
    const h = hash(key);

    // 二分查找第一个 pos >= h 的虚拟节点
    let lo = 0;
    let hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ring[mid].pos < h) lo = mid + 1;
      else hi = mid;
    }

    // 超出末尾则绕回到第一个节点
    const idx = lo % this.ring.length;
    return this.ring[idx].nodeId;
  }

  /** 返回当前环中所有唯一节点 ID */
  getNodes(): string[] {
    return [...new Set(this.ring.map((v) => v.nodeId))];
  }

  get size(): number {
    return this.ring.length / this.virtualNodes;
  }
}
