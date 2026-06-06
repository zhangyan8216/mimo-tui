// src/utils/sandbox.ts - Filesystem sandbox for safety

import path from 'path';
import fs from 'fs';
import os from 'os';

export class Sandbox {
  private allowedRoots: string[];
  private blockedPaths: string[];

  constructor(projectRoot: string) {
    this.allowedRoots = [
      path.resolve(projectRoot),
      path.join(os.homedir(), '.mimo'),
    ];
    this.blockedPaths = [
      '/etc', '/sys', '/proc', '/dev',
      'C:\\Windows', 'C:\\Program Files',
    ];
  }

  validatePath(filePath: string): { allowed: boolean; resolved: string; reason?: string } {
    const resolved = path.resolve(filePath);

    // Check blocked paths
    for (const blocked of this.blockedPaths) {
      if (resolved.startsWith(blocked)) {
        return { allowed: false, resolved, reason: `Path is in blocked directory: ${blocked}` };
      }
    }

    // Check symlink traversal
    try {
      const stat = fs.lstatSync(resolved);
      if (stat.isSymbolicLink()) {
        const realPath = fs.realpathSync(resolved);
        return this.validatePath(realPath);
      }
    } catch {
      // File doesn't exist yet - check parent directory
      const parent = path.dirname(resolved);
      try {
        const parentStat = fs.lstatSync(parent);
        if (parentStat.isSymbolicLink()) {
          const realParent = fs.realpathSync(parent);
          return this.validatePath(path.join(realParent, path.basename(resolved)));
        }
      } catch {
        // Parent doesn't exist either - will fail on actual operation
      }
    }

    // Check if within allowed roots
    const isAllowed = this.allowedRoots.some(root =>
      resolved.startsWith(root) || resolved === root
    );

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
