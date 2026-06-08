// src/utils/sandbox.ts - Filesystem sandbox for safety

import path from 'path';
import fs from 'fs';
import os from 'os';
import { getMimoHome } from './paths.js';

export class Sandbox {
  private allowedRoots: string[];
  private blockedPaths: string[];

  constructor(projectRoot: string) {
    this.allowedRoots = [
      path.resolve(projectRoot),
      getMimoHome(),
    ];
    this.blockedPaths = [
      '/etc', '/sys', '/proc', '/dev',
      'C:\\Windows', 'C:\\Program Files',
    ].map(p => path.resolve(p) + path.sep); // Normalize with trailing separator for boundary check
  }

  validatePath(filePath: string, _depth = 0): { allowed: boolean; resolved: string; reason?: string } {
    // Prevent infinite recursion on symlink cycles
    if (_depth > 10) {
      return { allowed: false, resolved: path.resolve(filePath), reason: 'Symlink depth exceeded (possible cycle)' };
    }
    const resolved = path.resolve(filePath);
    const normalizedResolved = resolved.toLowerCase() + path.sep;

    // Check blocked paths (case-insensitive on Windows, boundary-aware)
    for (const blocked of this.blockedPaths) {
      const normalizedBlocked = os.platform() === 'win32' ? blocked.toLowerCase() : blocked;
      if (normalizedResolved.startsWith(normalizedBlocked) || resolved.toLowerCase() === blocked.slice(0, -1).toLowerCase()) {
        return { allowed: false, resolved, reason: `Path is in blocked directory: ${blocked.slice(0, -1)}` };
      }
    }

    // Check symlink traversal
    try {
      const stat = fs.lstatSync(resolved);
      if (stat.isSymbolicLink()) {
        const realPath = fs.realpathSync(resolved);
        return this.validatePath(realPath, _depth + 1);
      }
    } catch {
      // File doesn't exist yet - check parent directory
      const parent = path.dirname(resolved);
      try {
        const parentStat = fs.lstatSync(parent);
        if (parentStat.isSymbolicLink()) {
          const realParent = fs.realpathSync(parent);
          return this.validatePath(path.join(realParent, path.basename(resolved)), _depth + 1);
        }
      } catch {
        // Parent doesn't exist either - will fail on actual operation
      }
    }

    // Check if within allowed roots (boundary-aware, case-insensitive on Windows)
    const isAllowed = this.allowedRoots.some(root => {
      const normalizedRoot = (os.platform() === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root)) + path.sep;
      return normalizedResolved.startsWith(normalizedRoot) || resolved.toLowerCase() === path.resolve(root).toLowerCase();
    });

    if (!isAllowed) {
      return {
        allowed: false,
        resolved,
        reason: `Path is outside allowed directories. Allowed: ${this.allowedRoots.join(', ')}`,
      };
    }

    return { allowed: true, resolved };
  }

  addAllowedRoot(root: string): void {
    this.allowedRoots.push(path.resolve(root));
  }
}
