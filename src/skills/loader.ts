// src/skills/loader.ts - Load skills from .mimo/skills/ and .claude/skills/

import fs from 'fs';
import path from 'path';
import type { Skill } from '../api/types.js';

const SKILL_DIRS = [
  '.mimo/skills',
  '.claude/skills',  // Compatible with Claude Code skills
];

export function loadSkills(projectRoot: string, globalDir?: string): Skill[] {
  const skills: Skill[] = [];

  // Load project skills
  for (const dir of SKILL_DIRS) {
    const skillsDir = path.join(projectRoot, dir);
    if (fs.existsSync(skillsDir)) {
      skills.push(...loadSkillsFromDir(skillsDir));
    }
  }

  // Load global skills
  if (globalDir) {
    const globalSkillsDir = path.join(globalDir, 'skills');
    if (fs.existsSync(globalSkillsDir)) {
      skills.push(...loadSkillsFromDir(globalSkillsDir));
    }
  }

  return skills;
}

function loadSkillsFromDir(dir: string): Skill[] {
  const skills: Skill[] = [];

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const skill = parseSkill(content, filePath);
        if (skill) skills.push(skill);
      } catch {
        // Skip invalid skill files
      }
    }
  } catch {
    // Directory read error
  }

  return skills;
}

function parseSkill(content: string, filePath: string): Skill | null {
  // Parse frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  const meta: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      meta[match[1]] = match[2].trim();
    }
  }

  return {
    name: meta.name || path.basename(filePath, '.md'),
    description: meta.description || '',
    path: filePath,
    content: body.trim(),
    triggers: meta.triggers ? meta.triggers.split(',').map(t => t.trim()) : undefined,
  };
}

export function findSkillByTrigger(skills: Skill[], input: string): Skill | null {
  const lowerInput = input.toLowerCase();
  return skills.find(s =>
    s.triggers?.some(t => lowerInput.includes(t.toLowerCase())) ||
    lowerInput.startsWith(`/${s.name}`)
  ) || null;
}
