/**
 * Expo Updates 协议 v1 引入的两种 directive 响应：
 *
 * - rollBackToEmbedded：让客户端回退到原生安装包内嵌的 update
 * - noUpdateAvailable：明确告知客户端"你已经是最新了"，避免再下载一份相同 manifest
 *
 * directive 响应不带 launchAsset/assets，只有一个 directive 段。
 */

/**
 * 用一个显式错误类型表示"当前没有新更新可下发"。
 * 让上层把它当作正常业务分支而不是异常故障来处理。
 */
export class NoUpdateAvailableError extends Error {}

export type RollBackDirective = {
  type: 'rollBackToEmbedded';
  parameters: { commitTime: string };
};

export type NoUpdateAvailableDirective = {
  type: 'noUpdateAvailable';
};

/**
 * commitTime 用来给客户端判断指令的新旧：客户端会丢弃比上次执行更老的同类 directive。
 * 来源：方案 B 下取自 deployment.json.history 最后一条 entry 的 at 字段。
 */
export function createRollBackDirective(commitTime: string): RollBackDirective {
  return {
    type: 'rollBackToEmbedded',
    parameters: { commitTime },
  };
}

export function createNoUpdateAvailableDirective(): NoUpdateAvailableDirective {
  return { type: 'noUpdateAvailable' };
}
