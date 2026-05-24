/**
 * 显式发布指针：updates/<rv>/deployment.json
 *
 * 服务端从 deployment.json 读 active 字段，决定下发哪一份发布。
 * - active 是发布目录名（时间戳），或者特殊值 "embedded" 表示回滚到原生包内嵌版本
 * - history 记录每次切换，作为审计 + 回滚 directive 的 commitTime 来源
 *
 * 每个发布目录都必须含 release.json（由 publish 路由或 record-release.cjs 生成）：
 *   { id: uuid, publishedAt: iso, notes, gitSha, source }
 * id 直接作为下发 manifest 的 id，publishedAt 作为 createdAt。
 *
 * 找不到 deployment.json 或 release.json 直接抛错——不再做"扫目录拿最大时间戳 +
 * sha256 metadata 当 id"那套老逻辑的兜底。
 */
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';

function getUpdatesRoot(): string {
  return process.env.UPDATES_DIR ?? 'updates';
}

export type DeploymentHistoryEntry = {
  at: string; // 切换时间 ISO 8601
  from: string | null; // 切换前的 active 值
  to: string; // 切换后的 active 值
  reason?: string; // 来源：publish / rollback / 自由文本
};

export type Deployment = {
  active: string; // 发布目录名 或 "embedded"
  previous: string | null;
  history: DeploymentHistoryEntry[];
};

/**
 * 路由层只需要这两种"结果状态"。
 */
export type ActiveUpdate =
  | { kind: 'normal'; bundlePath: string; id: string; createdAt: string }
  | { kind: 'rollback'; commitTime: string };

async function readDeploymentAsync(runtimeVersion: string): Promise<Deployment> {
  const file = path.join(getUpdatesRoot(), runtimeVersion, 'deployment.json');
  if (!fsSync.existsSync(file)) {
    throw new Error(`No deployment found for runtime version: ${runtimeVersion}`);
  }
  return JSON.parse(await fs.readFile(file, 'utf-8'));
}

async function readReleaseAsync(bundlePath: string): Promise<{ id: string; createdAt: string }> {
  const releaseFile = path.join(bundlePath, 'release.json');
  if (!fsSync.existsSync(releaseFile)) {
    throw new Error(`Missing release.json at ${bundlePath}`);
  }
  const release = JSON.parse(await fs.readFile(releaseFile, 'utf-8'));
  return { id: release.id, createdAt: release.publishedAt };
}

/**
 * 统一入口：根据 runtimeVersion 解析"当前应该下发什么"。
 *
 * 三种返回路径：
 *   - kind=normal：正常发布，附带 bundlePath / id / createdAt
 *   - kind=rollback：回滚到 embedded，附带 commitTime
 *   - 抛错：runtimeVersion 目录不存在 / deployment.json 不存在 / release.json 不存在 / 数据损坏
 */
export async function resolveActiveUpdateAsync(runtimeVersion: string): Promise<ActiveUpdate> {
  const root = path.join(getUpdatesRoot(), runtimeVersion);
  if (!fsSync.existsSync(root)) {
    throw new Error('Unsupported runtime version');
  }

  const deployment = await readDeploymentAsync(runtimeVersion);

  // 情况 1：显式声明回滚到 embedded
  if (deployment.active === 'embedded') {
    const lastEntry = deployment.history[deployment.history.length - 1];
    if (!lastEntry) {
      throw new Error('Embedded rollback recorded without history entry.');
    }
    return { kind: 'rollback', commitTime: lastEntry.at };
  }

  // 情况 2：普通发布
  const bundlePath = path.join(root, deployment.active);
  if (!fsSync.existsSync(bundlePath)) {
    throw new Error(`Active release dir not found: ${deployment.active}`);
  }
  const { id, createdAt } = await readReleaseAsync(bundlePath);
  return { kind: 'normal', bundlePath, id, createdAt };
}

/**
 * 给 assets 路由用的便捷封装：只关心 bundle 路径，回滚态时直接抛错。
 * 回滚到 embedded 时没有服务端可下发的资源，assets 接口应当 404。
 */
export async function getActiveBundlePathForRuntimeVersionAsync(
  runtimeVersion: string,
): Promise<string> {
  const active = await resolveActiveUpdateAsync(runtimeVersion);
  if (active.kind !== 'normal') {
    throw new Error(`Active deployment for runtime ${runtimeVersion} is in rollback state.`);
  }
  return active.bundlePath;
}
