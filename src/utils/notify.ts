// src/utils/notify.ts - 完成通知

import { spawn } from 'child_process';
import os from 'os';

/** 响应完成时播放提示音 */
export function notifyComplete(): void {
  const platform = os.platform();

  if (platform === 'win32') {
    // Windows: 使用 PowerShell 播放提示音
    try {
      spawn('powershell', ['-c', '[console]::beep(800,200)'], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } catch { /* ignore */ }
  } else if (platform === 'darwin') {
    // macOS
    try {
      spawn('afplay', ['/System/Library/Sounds/Glass.aiff'], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } catch { /* ignore */ }
  } else {
    // Linux
    try {
      spawn('paplay', ['/usr/share/sounds/freedesktop/stereo/complete.oga'], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } catch { /* ignore */ }
  }
}

/** 发送系统通知 (跨平台) */
export function sendNotification(title: string, body: string): void {
  const platform = os.platform();

  if (platform === 'win32') {
    try {
      spawn('powershell', [
        '-c',
        `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(3000, '${title}', '${body}', 'Info')`,
      ], { stdio: 'ignore', detached: true }).unref();
    } catch { /* ignore */ }
  } else if (platform === 'darwin') {
    try {
      spawn('osascript', ['-e', `display notification "${body}" with title "${title}"`], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } catch { /* ignore */ }
  }
}
