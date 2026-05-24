/**
 * Crypto 原语：哈希、Base64URL、RSA-SHA256 签名、structured-headers dictionary。
 *
 * 这一层是纯函数，无 IO 无环境依赖。需要读私钥再做签名的高阶封装在 ./signing.ts。
 */
import crypto, { type BinaryLike, type BinaryToTextEncoding } from 'crypto';
import type { Dictionary } from 'structured-headers';

// 统一封装 hash 生成，避免每个调用点都重复指定算法和编码。
export function createHash(
  data: BinaryLike,
  hashingAlgorithm: string,
  encoding: BinaryToTextEncoding,
): string {
  return crypto.createHash(hashingAlgorithm).update(data).digest(encoding) as string;
}

// Expo Updates 规范里资源 hash 用 base64url（URL 安全 base64），不是标准 base64。
// 这里把 `+`、`/`、尾部 `=` 转成 URL 安全形式。
export function toBase64URL(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 对 manifest/directive 的 JSON 字符串做 RSA-SHA256 签名。
// 返回的 base64 字符串会被包进 structured-headers dictionary，写入 expo-signature 响应头。
export function signRSASHA256(data: string, privateKey: string): string {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data, 'utf8');
  sign.end();
  return sign.sign(privateKey, 'base64');
}

// structured-headers 库要求签名字段用 Dictionary 结构。
// 这里把普通对象（sig + keyid）转成库能接受的表示。
export function convertToDictionaryItemsRepresentation(obj: { [key: string]: string }): Dictionary {
  return new Map(
    Object.entries(obj).map(([k, v]) => {
      return [k, [v, new Map()]];
    }),
  );
}
