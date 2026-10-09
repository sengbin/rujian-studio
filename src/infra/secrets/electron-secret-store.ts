// ------------------------------------------------------------------------
// 名称：electron-secret-store.ts
// 说明：密钥存储端口的桌面实现：每个密钥用系统凭据加密后保存到数据目录下的文件。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：加密由 Electron 的 safeStorage 提供（通过 SecretCipher 注入，便于测试）；系统不支持加密时拒绝保存，不降级为明文；无法解密的密钥按未设置处理，由用户重新填写；密钥文件损坏时读取按未设置处理，但保存、删除会拒绝，避免覆盖其他服务商的密钥。
// ------------------------------------------------------------------------

import { SecretStore } from '../../domain/ports/secret-store';
import { readJsonObject, readJsonObjectStrict, writeJsonObject } from '../storage/json-file';

/** 系统级加解密能力，与 Electron 的 safeStorage 结构兼容。 */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** 系统不支持加密存储时的提示。 */
const ENCRYPTION_UNAVAILABLE_MESSAGE = '当前系统不支持安全存储，无法保存访问密钥。';

/** 保存在文件中的内容：密钥名 → 加密后内容的 base64。 */
type SecretFileContent = Record<string, string>;

/** 把加密后的密钥保存在单个 JSON 文件中的存储。 */
export class ElectronSecretStore implements SecretStore {
  /**
   * @param filePath 保存密钥的文件的绝对路径。
   * @param cipher 加解密能力。
   */
  constructor(
    private readonly filePath: string,
    private readonly cipher: SecretCipher
  ) {}

  async get(key: string): Promise<string | undefined> {
    const encrypted = this.readFile()[key];
    if (encrypted === undefined || !this.cipher.isEncryptionAvailable()) {
      return undefined;
    }
    try {
      return this.cipher.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.cipher.isEncryptionAvailable()) {
      throw new Error(ENCRYPTION_UNAVAILABLE_MESSAGE);
    }
    const content = this.readFileForUpdate();
    content[key] = this.cipher.encryptString(value).toString('base64');
    this.writeFile(content);
  }

  async delete(key: string): Promise<void> {
    const content = this.readFileForUpdate();
    if (!(key in content)) {
      return;
    }
    delete content[key];
    this.writeFile(content);
  }

  /** 读取文件内容供查询：文件不存在或内容损坏时按空处理。 */
  private readFile(): SecretFileContent {
    return pickSecrets(readJsonObject(this.filePath));
  }

  /**
   * 读取文件内容供修改：文件存在却损坏时不能按空处理，否则下一次保存会覆盖掉其他服务商的密钥。
   * @throws Error 文件损坏或无法读取。
   */
  private readFileForUpdate(): SecretFileContent {
    try {
      return pickSecrets(readJsonObjectStrict(this.filePath));
    } catch (error) {
      throw new Error(`密钥文件无法读取或已损坏，为避免覆盖已保存的密钥，未保存。请备份并删除该文件后重新填写密钥：${this.filePath}`, { cause: error });
    }
  }

  private writeFile(content: SecretFileContent): void {
    writeJsonObject(this.filePath, content);
  }
}

/** 只保留值为字符串的项。 */
function pickSecrets(content: Record<string, unknown>): SecretFileContent {
  return Object.fromEntries(Object.entries(content).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
