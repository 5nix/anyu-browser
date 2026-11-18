import { mkdirSync, statSync } from 'node:fs';

export function ensureDownloadsDirectory(dir: string, fallbackDir?: string): string {
  try {
    mkdirSync(dir, { recursive: true });
    if (!statSync(dir).isDirectory()) throw new Error('Not a directory');
    return dir;
  } catch (error) {
    if (fallbackDir && fallbackDir !== dir) {
      mkdirSync(fallbackDir, { recursive: true });
      if (!statSync(fallbackDir).isDirectory()) throw new Error('Not a directory');
      return fallbackDir;
    }
    throw error;
  }
}
