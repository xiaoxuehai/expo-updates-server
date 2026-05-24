/**
 * 读取发布目录里的产物文件。
 *
 * 这一层都是相对 bundlePath 的纯 IO 函数，不关心"哪个发布是 active"——
 * 那部分逻辑在 ./deployment.ts 里，调用方传进具体的 bundlePath。
 */
import fs from 'fs/promises';
import mime from 'mime';
import path from 'path';

import { createHash, toBase64URL } from './crypto.js';

export type MetadataAsset = {
  path: string;
  ext: string;
};

export type PlatformMetadata = {
  bundle: string;
  assets: MetadataAsset[];
};

export type MetadataJson = {
  fileMetadata: Record<'ios' | 'android', PlatformMetadata>;
};

/**
 * metadata.json 是 `expo export` 产物的核心索引，记录各平台 bundle 与 asset 的相对路径。
 * manifest 接口大部分内容本质上是把这份 metadata 转换成 Expo 协议格式。
 */
export async function getMetadataAsync({
  updateBundlePath,
  runtimeVersion,
}: {
  updateBundlePath: string;
  runtimeVersion: string;
}): Promise<{ metadataJson: MetadataJson }> {
  try {
    const metadataPath = `${updateBundlePath}/metadata.json`;
    const buf = await fs.readFile(path.resolve(metadataPath), null);
    return { metadataJson: JSON.parse(buf.toString('utf-8')) };
  } catch (error) {
    throw new Error(`No update found with runtime version: ${runtimeVersion}. Error: ${error}`);
  }
}

/**
 * expoConfig.json 不是 `expo export` 默认产物，而是 publish 脚本额外生成并复制进发布目录的。
 * 服务端把它放进 manifest.extra.expoClient，让客户端可以通过 Constants.expoConfig 读到
 * 对应那一版 app.json 的配置（OTA 后配置和代码版本对齐）。
 */
export async function getExpoConfigAsync({
  updateBundlePath,
  runtimeVersion,
}: {
  updateBundlePath: string;
  runtimeVersion: string;
}): Promise<Record<string, unknown>> {
  try {
    const expoConfigPath = `${updateBundlePath}/expoConfig.json`;
    const buf = await fs.readFile(path.resolve(expoConfigPath), null);
    return JSON.parse(buf.toString('utf-8'));
  } catch (error) {
    throw new Error(
      `No expo config json found with runtime version: ${runtimeVersion}. Error: ${error}`,
    );
  }
}

type GetAssetMetadataArg =
  | {
      updateBundlePath: string;
      filePath: string;
      ext: null;
      isLaunchAsset: true;
      runtimeVersion: string;
      platform: string;
    }
  | {
      updateBundlePath: string;
      filePath: string;
      ext: string;
      isLaunchAsset: false;
      runtimeVersion: string;
      platform: string;
    };

/**
 * 把磁盘上的某个 asset 转换成 manifest 协议里的 asset 描述。
 * 出现在 manifest.assets 列表，或者作为 manifest.launchAsset 单独存在。
 *
 * - hash: 客户端做完整性校验的 sha256，base64url 编码
 * - key:  资源缓存键，沿用 md5 hex
 * - url:  指回 /api/assets，客户端按这个 URL 拉真正的二进制
 */
export async function getAssetMetadataAsync(arg: GetAssetMetadataArg) {
  const assetFilePath = `${arg.updateBundlePath}/${arg.filePath}`;
  const asset = await fs.readFile(path.resolve(assetFilePath), null);

  const assetHash = toBase64URL(createHash(asset, 'sha256', 'base64'));
  const key = createHash(asset, 'md5', 'hex');
  const keyExtensionSuffix = arg.isLaunchAsset ? 'bundle' : arg.ext;
  // launch asset 是平台对应的 JS bundle，不按图片/字体之类的 asset MIME 处理。
  const contentType = arg.isLaunchAsset ? 'application/javascript' : mime.getType(arg.ext);

  return {
    hash: assetHash,
    key,
    fileExtension: `.${keyExtensionSuffix}`,
    contentType,
    url: `${process.env.HOSTNAME}/api/assets?asset=${assetFilePath}&runtimeVersion=${arg.runtimeVersion}&platform=${arg.platform}`,
  };
}
