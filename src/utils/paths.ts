// src/utils/paths.ts - Resolve user-level Mimo data paths.

import os from 'os';
import path from 'path';

export function getMimoHome(): string {
  return process.env.MIMO_HOME || path.join(os.homedir(), '.mimo');
}

export function getMimoPath(...segments: string[]): string {
  return path.join(getMimoHome(), ...segments);
}
