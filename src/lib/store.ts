/**
 * 本地文件存储的底层工具。
 * 项目不引入任何数据库，所有数据都以文件形式落在 data/ 目录下，
 * 方便直接打开查看、也能被 git 忽略。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from './config';

/** 把相对 data 目录的路径解析成绝对路径 */
export function dataPath(...segments: string[]): string {
  return path.join(process.cwd(), getDataDir(), ...segments);
}

/** 确保目录存在（递归创建），已存在时静默返回 */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** 确保某个文件所在的目录存在 */
export async function ensureParent(filePath: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
}

/**
 * 追加一行 JSON 到指定文件（JSONL 格式）。
 * 追加写是原子的，且不需要读取原文件，所以很适合用来收集未答问题和反馈。
 */
export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  await ensureParent(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * 原子写文本文件：先写临时文件再 rename。
 * 避免进程在写入过程中退出，导致留下一个被截断的半截 JSON。
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await ensureParent(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

/** 读取文本文件，不存在时返回 null（而不是抛 ENOENT） */
export async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** 读取并解析 JSON 文件，不存在或解析失败时返回 null */
export async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  const raw = await readFileOrNull(filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[store] 文件内容不是合法 JSON，已忽略：${filePath}`);
    return null;
  }
}

/** 读取 JSONL 文件的每一行，跳过空行与坏行 */
export async function readJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await readFileOrNull(filePath);
  if (!raw) return [];

  const records: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as T);
    } catch {
      // 单行损坏不影响整体，跳过即可
    }
  }
  return records;
}
