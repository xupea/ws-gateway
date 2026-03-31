/**
 * 启动入口（bootstrap）
 *
 * 必须在加载任何依赖 config 的模块之前，先异步解析好 NODE_ID 并写入
 * process.env，确保 config/index.ts 在同步执行时能读到正确的值。
 *
 * 启动顺序：
 *   1. 解析 NODE_ID（ECS 元数据 / 环境变量 / PID 兜底）
 *   2. 写入 process.env.NODE_ID
 *   3. 动态 require('./index') 触发主程序加载和执行
 */
import dotenv from 'dotenv';
import { resolveNodeId } from './cluster/node-id';

// 必须在 resolveNodeId() 之前加载 .env，
// 否则本地 NODE_ID=node-1 等变量尚未写入 process.env
dotenv.config();

async function bootstrap(): Promise<void> {
  const nodeId = await resolveNodeId();
  process.env.NODE_ID = nodeId;

  // 动态 require，确保 config 在 NODE_ID 写入后才被加载
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./index');
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] fatal error:', err);
  process.exit(1);
});
