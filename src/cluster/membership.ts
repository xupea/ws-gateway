/**
 * 集群成员管理
 *
 * 职责：
 *   1. 注册本节点到 Redis，并定期续期心跳
 *   2. 定期从 Redis 同步存活节点列表，更新本地哈希环
 *   3. 对外暴露 getTargetNode(userId)，替代 redis.getUserNode
 *
 * 前提：负载均衡器按 userId 做一致性哈希粘滞，
 *       保证同一用户始终连接到哈希环上对应的节点。
 */
import * as redis from '../redis';
import config from '../config';
import { ConsistentHashRing } from './hashring';

const ring = new ConsistentHashRing(config.cluster.virtualNodes);
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export async function init(): Promise<void> {
  await redis.registerNode(config.server.nodeId);
  await syncRing();

  heartbeatTimer = setInterval(async () => {
    try {
      await redis.registerNode(config.server.nodeId);
      await syncRing();
    } catch (err) {
      console.error('[Membership] heartbeat error:', (err as Error).message);
    }
  }, config.cluster.heartbeatIntervalMs);

  console.log(`[Membership] initialized, nodes: ${ring.getNodes().join(', ')}`);
}

export async function stop(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  await redis.deregisterNode(config.server.nodeId);
  console.log('[Membership] deregistered');
}

/**
 * 根据 userId 计算目标节点，无存活节点时返回 null
 */
export function getTargetNode(userId: string): string | null {
  return ring.getNode(userId);
}

async function syncRing(): Promise<void> {
  const liveNodes = await redis.getLiveNodes();
  const currentSet = new Set(ring.getNodes());
  const nextSet = new Set(liveNodes);

  for (const n of nextSet) {
    if (!currentSet.has(n)) {
      ring.addNode(n);
      console.log(`[Membership] node joined: ${n}`);
    }
  }
  for (const n of currentSet) {
    if (!nextSet.has(n)) {
      ring.removeNode(n);
      console.log(`[Membership] node left: ${n}`);
    }
  }
}
