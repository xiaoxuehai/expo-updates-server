/**
 * 代码签名：私钥读取 + 高阶签名封装。
 *
 * 私钥路径通过 PRIVATE_KEY_PATH 环境变量指定；服务端启动时不要求存在。
 * 只有客户端在请求里声明 expo-expect-signature 时，才会触发读取与签名。
 */
import fs from 'fs/promises';
import path from 'path';
import { serializeDictionary } from 'structured-headers';

import { convertToDictionaryItemsRepresentation, signRSASHA256 } from './crypto.js';

/**
 * 客户端要求签名但服务端未配置私钥时抛出。
 * manifest 路由捕获后返回 400，提示启动参数缺失。
 */
export class CodeSigningKeyMissingError extends Error {
  constructor() {
    super('Code signing requested but no key supplied when starting server.');
  }
}

export async function getPrivateKeyAsync(): Promise<string | null> {
  const privateKeyPath = process.env.PRIVATE_KEY_PATH;
  if (!privateKeyPath) {
    return null;
  }
  const pemBuffer = await fs.readFile(path.resolve(privateKeyPath));
  return pemBuffer.toString('utf8');
}

/**
 * 如果客户端通过 expo-expect-signature header 声明需要签名，则对 payload 做 RSA-SHA256 签名，
 * 并返回 structured-headers dictionary 序列化后的字符串（直接写进 expo-signature 响应头）。
 *
 * - 客户端没要求签名 → 返回 null（调用方据此跳过 expo-signature header）
 * - 客户端要求签名但未配置私钥 → 抛 CodeSigningKeyMissingError
 */
export async function signPayloadIfRequestedAsync(
  payload: string,
  expectSignatureHeader: string | undefined,
): Promise<string | null> {
  if (!expectSignatureHeader) {
    return null;
  }
  const privateKey = await getPrivateKeyAsync();
  if (!privateKey) {
    throw new CodeSigningKeyMissingError();
  }
  const signature = signRSASHA256(payload, privateKey);
  const dictionary = convertToDictionaryItemsRepresentation({
    sig: signature,
    keyid: 'main',
  });
  return serializeDictionary(dictionary);
}
