import type { Context } from 'hono';

import { getAssetMetadataAsync, getExpoConfigAsync, getMetadataAsync } from '../../core/bundle.js';
import type { ActiveUpdate } from '../../core/deployment.js';
import { NoUpdateAvailableError } from '../../core/directives.js';
import { signPayloadIfRequestedAsync } from '../../core/signing.js';
import { buildMultipartForm, sendMultipartResponse } from './multipart.js';

/**
 * 普通更新响应：
 * - 读取当前 active 发布的 metadata.json 与 expoConfig.json
 * - 把各 platform 的 launchAsset 和 assets 列表转换成 Expo 协议格式
 * - 可选签名 + multipart 下发
 *
 * 如果客户端自报的 expo-current-update-id 等于当前 active 的 id（仅 protocol v1），
 * 抛 NoUpdateAvailableError；外层路由捕获后切到 noUpdateAvailable 响应，
 * 避免重复下发已经在本地的版本。
 */
export async function putNormalUpdateInResponseAsync(
  c: Context,
  active: Extract<ActiveUpdate, { kind: 'normal' }>,
  runtimeVersion: string,
  platform: 'ios' | 'android',
  protocolVersion: number,
): Promise<Response> {
  const { bundlePath, id, createdAt } = active;

  const currentUpdateId = c.req.header('expo-current-update-id');
  // protocol v0 不支持 noUpdateAvailable directive，那种情况下重复下发是预期行为。
  if (currentUpdateId === id && protocolVersion === 1) {
    throw new NoUpdateAvailableError();
  }

  const { metadataJson } = await getMetadataAsync({
    updateBundlePath: bundlePath,
    runtimeVersion,
  });
  const expoConfig = await getExpoConfigAsync({
    updateBundlePath: bundlePath,
    runtimeVersion,
  });

  const platformSpecificMetadata = metadataJson.fileMetadata[platform];
  const manifest = {
    id,
    createdAt,
    runtimeVersion,
    assets: await Promise.all(
      platformSpecificMetadata.assets.map((asset) =>
        getAssetMetadataAsync({
          updateBundlePath: bundlePath,
          filePath: asset.path,
          ext: asset.ext,
          runtimeVersion,
          platform,
          isLaunchAsset: false,
        }),
      ),
    ),
    launchAsset: await getAssetMetadataAsync({
      updateBundlePath: bundlePath,
      filePath: platformSpecificMetadata.bundle,
      isLaunchAsset: true,
      runtimeVersion,
      platform,
      ext: null,
    }),
    metadata: {},
    extra: {
      // expoConfig 被注入 extra.expoClient，让客户端 Constants.expoConfig 拿到对应版本的配置。
      expoClient: expoConfig,
    },
  };

  const manifestPayload = JSON.stringify(manifest);
  const signature = await signPayloadIfRequestedAsync(
    manifestPayload,
    c.req.header('expo-expect-signature'),
  );

  // extensions.assetRequestHeaders 允许服务端为每个 asset 指定额外请求头。
  // 真实用途如鉴权、CDN 命中控制；这里放示例值。
  const assetRequestHeaders: { [key: string]: object } = {};
  [...manifest.assets, manifest.launchAsset].forEach((asset) => {
    assetRequestHeaders[asset.key] = { 'test-header': 'test-header-value' };
  });

  const form = buildMultipartForm([
    { name: 'manifest', payload: manifestPayload, signature },
    { name: 'extensions', payload: JSON.stringify({ assetRequestHeaders }) },
  ]);

  return sendMultipartResponse(c, form, protocolVersion);
}
