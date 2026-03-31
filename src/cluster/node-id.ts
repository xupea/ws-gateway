import { get } from 'http';

/**
 * 异步解析当前节点的唯一 ID，优先级：
 *   1. 环境变量 NODE_ID（手动指定，最高优先级）
 *   2. ECS 容器元数据接口 → Task ARN 末段（ECS EC2 / Fargate 均适用）
 *   3. 进程 PID 兜底（本地开发）
 *
 * ECS agent 会自动注入 ECS_CONTAINER_METADATA_URI_V4，
 * 通过它可以拿到 TaskARN，格式如：
 *   arn:aws:ecs:us-east-1:123456789012:task/my-cluster/abc123def456
 * 取最后一段 abc123def456 作为节点 ID，同一 ECS 集群内全局唯一。
 */
export async function resolveNodeId(): Promise<string> {
  if (process.env.NODE_ID) {
    return process.env.NODE_ID;
  }

  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (metadataUri) {
    try {
      const taskArn = await fetchEcsTaskArn(metadataUri);
      const shortId = taskArn.split('/').pop();
      if (shortId) {
        console.log(`[NodeId] resolved from ECS metadata: ${shortId}`);
        return shortId;
      }
    } catch (err) {
      console.warn('[NodeId] ECS metadata fetch failed, falling back to PID:', (err as Error).message);
    }
  }

  const fallback = `node-${process.pid}`;
  console.warn(`[NodeId] ECS_CONTAINER_METADATA_URI_V4 not found, using fallback: ${fallback}`);
  return fallback;
}

function fetchEcsTaskArn(metadataUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(`${metadataUri}/task`, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`ECS metadata returned HTTP ${res.statusCode}`));
        return;
      }
      let raw = '';
      res.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      res.on('end', () => {
        try {
          const body = JSON.parse(raw) as { TaskARN?: string };
          if (!body.TaskARN) {
            reject(new Error('TaskARN missing in ECS metadata response'));
            return;
          }
          resolve(body.TaskARN);
        } catch {
          reject(new Error('failed to parse ECS metadata JSON'));
        }
      });
    }).on('error', reject);
  });
}
