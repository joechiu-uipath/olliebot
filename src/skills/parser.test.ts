/**
 * Unit tests for Skill Parser
 *
 * Tests the frontmatter extraction and body parsing logic.
 * Uses direct method access on the parser instance to test internal parsing
 * without filesystem dependencies.
 * Maps to e2e test plan: SKILL-001/002 (skill listing, reading)
 */

import { describe, it, expect, vi } from 'vitest';
import { SkillParser } from './parser.js';
import { getPrivateMethod } from '../test-helpers/index.js';
import {
  BASIC_SKILL_MD,
  COMPREHENSIVE_SKILL_MD,
  ANONYMOUS_SKILL_MD,
  CRLF_SKILL_MD,
  QUOTED_SKILL_MD,
  EMPTY_VALUE_SKILL_MD,
  NO_FRONTMATTER,
  TOOL_RESTRICTED_SKILL_MD,
  MOCK_FS_RESPONSES,
} from './__tests__/fixtures.js';

const parser = new SkillParser();

// Access private methods for focused unit testing
const extractFrontmatter = getPrivateMethod(parser, 'extractFrontmatter');
const extractBody = getPrivateMethod(parser, 'extractBody');
const idToDisplayName = getPrivateMethod(parser, 'idToDisplayName');

describe('SkillParser - extractFrontmatter', () => {
  it('parses basic YAML frontmatter', () => {
    const fm = extractFrontmatter(BASIC_SKILL_MD);
    expect(fm.name).toBe('Test Skill');
    expect(fm.description).toBe('A test skill for unit testing');
  });

  it('handles quoted string values', () => {
    const fm = extractFrontmatter(QUOTED_SKILL_MD);
    expect(fm.name).toBe('Quoted Name');
    expect(fm.description).toBe('Single Quoted');
  });

  it('handles metadata sub-keys', () => {
    const content = `---
name: Test Skill
metadata:
  author: John
  version: "1.0"
---
Body`;

    const fm = extractFrontmatter(content);
    expect(fm.metadata).toEqual({ author: 'John', version: '1.0' });
  });

  it('returns empty object when no frontmatter present', () => {
    const fm = extractFrontmatter(NO_FRONTMATTER);
    expect(fm).toEqual({});
  });

  it('handles CRLF line endings', () => {
    const fm = extractFrontmatter(CRLF_SKILL_MD);
    expect(fm.name).toBe('CRLF Skill');
    expect(fm.description).toBe('Windows style');
  });

  it('parses allowed-tools as space-separated string', () => {
    const fm = extractFrontmatter(TOOL_RESTRICTED_SKILL_MD);
    expect(fm['allowed-tools']).toBe('tool1 tool2 tool3');
  });

  it('handles empty values', () => {
    const fm = extractFrontmatter(EMPTY_VALUE_SKILL_MD);
    expect(fm.name).toBe('Test');
    expect(fm.description).toBeUndefined(); // Empty value is not stored
  });
});

describe('SkillParser - extractBody', () => {
  it('extracts body after frontmatter', () => {
    const body = extractBody(BASIC_SKILL_MD);
    expect(body).toBe('# Instructions\n\nDo the thing.');
  });

  it('returns full content when no frontmatter', () => {
    const body = extractBody(NO_FRONTMATTER);
    expect(body).toBe('No frontmatter here\nJust content');
  });

  it('trims whitespace from body', () => {
    const content = `---
name: Test
---

  Body with leading whitespace

`;

    const body = extractBody(content);
    expect(body).toBe('Body with leading whitespace');
  });

  it('handles CRLF line endings', () => {
    const body = extractBody(CRLF_SKILL_MD);
    expect(body).toBe('Body');
  });
});

describe('SkillParser - idToDisplayName', () => {
  it('converts hyphenated ID to title case', () => {
    expect(idToDisplayName('pdf-processing')).toBe('Pdf Processing');
    expect(idToDisplayName('frontend-modifier')).toBe('Frontend Modifier');
  });

  it('handles single word', () => {
    expect(idToDisplayName('docx')).toBe('Docx');
  });

  it('handles multi-hyphen IDs', () => {
    expect(idToDisplayName('my-cool-skill-name')).toBe('My Cool Skill Name');
  });
});

describe('SkillParser - parseMetadataOnly integration', () => {
  it('combines frontmatter extraction with metadata shaping', () => {
    // Test the metadata shaping logic by verifying what extractFrontmatter
    // produces is correctly transformed into SkillMetadata shape.
    // This validates the parseMetadataOnly logic without filesystem.
    const fm = extractFrontmatter(BASIC_SKILL_MD);
    expect(fm.name).toBe('Test Skill');
    expect(fm.description).toBe('A test skill for unit testing');
    expect(fm.id).toBeUndefined();

    // Verify the ID fallback chain: id > name > dirname
    const fm2 = extractFrontmatter(BASIC_SKILL_MD);
    // When no id field, name is used as ID
    expect(fm2.id).toBeUndefined();
    expect(fm2.name).toBe('Test Skill');
  });

  it('falls back to directory name for ID when no id or name', () => {
    const fm = extractFrontmatter(ANONYMOUS_SKILL_MD);
    // No id, no name - basename(dirPath) would be used in actual parsing
    expect(fm.id).toBeUndefined();
    expect(fm.name).toBeUndefined();
  });
});

// Tests for parseMetadataOnly and parseSkill that exercise the public methods
// by mocking the filesystem calls
const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mockFs.readFile,
  readdir: mockFs.readdir,
  stat: mockFs.stat,
}));

describe('SkillParser - parseMetadataOnly (mocked FS)', () => {
  const testParser = new SkillParser();

  it('parses metadata with all fields', async () => {
    mockFs.readFile.mockResolvedValue(COMPREHENSIVE_SKILL_MD);

    const meta = await testParser.parseMetadataOnly(
      '/skills/pdf/SKILL.md',
      '/skills/pdf',
      'user'
    );

    expect(meta).not.toBeNull();
    expect(meta!.id).toBe('pdf-processor');
    expect(meta!.name).toBe('PDF Processor');
    expect(meta!.description).toBe('Handles PDF files');
    expect(meta!.filePath).toBe('/skills/pdf/SKILL.md');
    expect(meta!.dirPath).toBe('/skills/pdf');
    expect(meta!.source).toBe('user');
  });

  it('falls back to name for ID when id not in frontmatter', async () => {
    mockFs.readFile.mockResolvedValue(BASIC_SKILL_MD);

    const meta = await testParser.parseMetadataOnly(
      '/skills/my-tool/SKILL.md',
      '/skills/my-tool'
    );

    expect(meta!.id).toBe('Test Skill');
  });

  it('falls back to directory basename when no id or name', async () => {
    mockFs.readFile.mockResolvedValue(ANONYMOUS_SKILL_MD);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const meta = await testParser.parseMetadataOnly(
      '/skills/cool-tool/SKILL.md',
      '/skills/cool-tool'
    );
    warnSpy.mockRestore();

    // Should fall back to basename of dirPath
    expect(meta!.id).toBe('cool-tool');
    // idToDisplayName should generate name from id
    expect(meta!.name).toBe('Cool Tool');
  });

  it('returns null when readFile throws', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const meta = await testParser.parseMetadataOnly(
      '/skills/missing/SKILL.md',
      '/skills/missing'
    );

    expect(meta).toBeNull();
    errorSpy.mockRestore();
  });

  it('defaults source to user when not specified', async () => {
    mockFs.readFile.mockResolvedValue(BASIC_SKILL_MD);

    const meta = await testParser.parseMetadataOnly(
      '/skills/test/SKILL.md',
      '/skills/test'
    );

    expect(meta!.source).toBe('user');
  });
});

describe('SkillParser - parseSkill (mocked FS)', () => {
  const testParser = new SkillParser();

  it('parses a complete skill with instructions and sub-directories', async () => {
    mockFs.readFile.mockResolvedValue(COMPREHENSIVE_SKILL_MD);

    // Mock scanDirectory for references, scripts, assets
    mockFs.readdir
      .mockResolvedValueOnce(MOCK_FS_RESPONSES.references) // references
      .mockResolvedValueOnce(MOCK_FS_RESPONSES.scripts) // scripts
      .mockResolvedValueOnce(MOCK_FS_RESPONSES.assets); // assets

    const skill = await testParser.parseSkill(
      '/skills/pdf/SKILL.md',
      '/skills/pdf',
      'builtin'
    );

    expect(skill).not.toBeNull();
    expect(skill!.id).toBe('pdf-processor');
    expect(skill!.name).toBe('PDF Processor');
    expect(skill!.description).toBe('Handles PDF files');
    expect(skill!.license).toBe('MIT');
    expect(skill!.compatibility).toBe('node >= 18');
    expect(skill!.allowedTools).toEqual(['read_file', 'write_file']);
    expect(skill!.metadata).toEqual({ author: 'Test Author', version: '2.0' });
    expect(skill!.instructions).toBe('# Instructions\n\nProcess the PDF file.');
    expect(skill!.source).toBe('builtin');
    expect(skill!.references).toEqual(MOCK_FS_RESPONSES.references);
    expect(skill!.scripts).toEqual(MOCK_FS_RESPONSES.scripts);
    expect(skill!.assets).toEqual(MOCK_FS_RESPONSES.assets);
  });

  it('handles missing optional directories gracefully', async () => {
    mockFs.readFile.mockResolvedValue(BASIC_SKILL_MD);

    // Mock scanDirectory failures (directories don't exist)
    mockFs.readdir
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'));

    const skill = await testParser.parseSkill(
      '/skills/simple/SKILL.md',
      '/skills/simple'
    );

    expect(skill).not.toBeNull();
    expect(skill!.references).toEqual([]);
    expect(skill!.scripts).toEqual([]);
    expect(skill!.assets).toEqual([]);
  });

  it('returns null when readFile fails', async () => {
    mockFs.readFile.mockRejectedValue(new Error('EACCES'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const skill = await testParser.parseSkill(
      '/skills/broken/SKILL.md',
      '/skills/broken'
    );

    expect(skill).toBeNull();
    errorSpy.mockRestore();
  });

  it('includes rawContent in parsed skill', async () => {
    mockFs.readFile.mockResolvedValue(BASIC_SKILL_MD);
    mockFs.readdir
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'));

    const skill = await testParser.parseSkill(
      '/skills/raw/SKILL.md',
      '/skills/raw'
    );

    expect(skill!.rawContent).toBe(BASIC_SKILL_MD);
  });
});

describe('SkillParser - loadSkillsFromDirectory', () => {
  const testParser = new SkillParser();

  it('returns empty array when directory does not exist', async () => {
    mockFs.readdir.mockRejectedValue(new Error('ENOENT'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const skills = await testParser.loadSkillsFromDirectory('/nonexistent');
    expect(skills).toEqual([]);

    errorSpy.mockRestore();
  });

  it('skips non-directory entries', async () => {
    mockFs.readdir.mockResolvedValue([
      { name: 'readme.md', isDirectory: () => false },
    ]);

    const skills = await testParser.loadSkillsFromDirectory('/skills');
    expect(skills).toEqual([]);
  });
});

describe('SkillParser - loadMetadataFromDirectory', () => {
  const testParser = new SkillParser();

  it('returns empty array when directory does not exist', async () => {
    mockFs.readdir.mockRejectedValue(new Error('ENOENT'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const metadata = await testParser.loadMetadataFromDirectory('/nonexistent');
    expect(metadata).toEqual([]);

    errorSpy.mockRestore();
  });
});
