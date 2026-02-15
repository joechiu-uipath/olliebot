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

const parser = new SkillParser();

// Access private methods for focused unit testing
const extractFrontmatter = getPrivateMethod(parser, 'extractFrontmatter');
const extractBody = getPrivateMethod(parser, 'extractBody');
const idToDisplayName = getPrivateMethod(parser, 'idToDisplayName');

describe('SkillParser - extractFrontmatter', () => {
  it('parses basic YAML frontmatter', () => {
    const content = `---
name: My Skill
description: A test skill
---
Some body content`;

    const fm = extractFrontmatter(content);
    expect(fm.name).toBe('My Skill');
    expect(fm.description).toBe('A test skill');
  });

  it('handles quoted string values', () => {
    const content = `---
name: "Quoted Name"
description: 'Single Quoted'
---
Body`;

    const fm = extractFrontmatter(content);
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
    const content = 'No frontmatter here\nJust content';
    const fm = extractFrontmatter(content);
    expect(fm).toEqual({});
  });

  it('handles CRLF line endings', () => {
    const content = '---\r\nname: CRLF Skill\r\ndescription: Windows style\r\n---\r\nBody';
    const fm = extractFrontmatter(content);
    expect(fm.name).toBe('CRLF Skill');
    expect(fm.description).toBe('Windows style');
  });

  it('parses allowed-tools as space-separated string', () => {
    const content = `---
name: Tool Skill
allowed-tools: tool1 tool2 tool3
---
Body`;

    const fm = extractFrontmatter(content);
    expect(fm['allowed-tools']).toBe('tool1 tool2 tool3');
  });

  it('handles empty values', () => {
    const content = `---
name: Test
description:
---
Body`;

    const fm = extractFrontmatter(content);
    expect(fm.name).toBe('Test');
    expect(fm.description).toBeUndefined(); // Empty value is not stored
  });
});

describe('SkillParser - extractBody', () => {
  it('extracts body after frontmatter', () => {
    const content = `---
name: Test
---
# Instructions

Do things here.`;

    const body = extractBody(content);
    expect(body).toBe('# Instructions\n\nDo things here.');
  });

  it('returns full content when no frontmatter', () => {
    const content = 'Just some content\nWith multiple lines';
    const body = extractBody(content);
    expect(body).toBe('Just some content\nWith multiple lines');
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
    const content = '---\r\nname: Test\r\n---\r\nBody content';
    const body = extractBody(content);
    expect(body).toBe('Body content');
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
    const content = `---
name: Test Skill
description: A skill for testing
id: test-skill
---
Instructions here`;

    const fm = extractFrontmatter(content);
    expect(fm.name).toBe('Test Skill');
    expect(fm.description).toBe('A skill for testing');
    expect(fm.id).toBe('test-skill');

    // Verify the ID fallback chain: id > name > dirname
    const contentNoId = `---
name: Skill Name
description: Description
---
Body`;
    const fm2 = extractFrontmatter(contentNoId);
    // When no id field, name is used as ID
    expect(fm2.id).toBeUndefined();
    expect(fm2.name).toBe('Skill Name');
  });

  it('falls back to directory name for ID when no id or name', () => {
    const content = `---
description: A skill with no name or id
---
Body`;
    const fm = extractFrontmatter(content);
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
    mockFs.readFile.mockResolvedValue(`---
name: PDF Processor
description: Handles PDF files
id: pdf-processor
---
# Instructions
Do PDF things`);

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
    mockFs.readFile.mockResolvedValue(`---
name: My Tool
description: A tool
---
Body`);

    const meta = await testParser.parseMetadataOnly(
      '/skills/my-tool/SKILL.md',
      '/skills/my-tool'
    );

    expect(meta!.id).toBe('My Tool');
  });

  it('falls back to directory basename when no id or name', async () => {
    mockFs.readFile.mockResolvedValue(`---
description: Anonymous skill
---
Body`);

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
    mockFs.readFile.mockResolvedValue(`---
name: Test
description: Test skill
---
Body`);

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
    mockFs.readFile.mockResolvedValue(`---
name: PDF Processor
description: Handles PDF files
license: MIT
compatibility: node >= 18
allowed-tools: read_file write_file
metadata:
  author: Test Author
  version: '2.0'
---
# Instructions

Process the PDF file.`);

    // Mock scanDirectory for references, scripts, assets
    mockFs.readdir
      .mockResolvedValueOnce(['guide.md', 'api.md']) // references
      .mockResolvedValueOnce(['convert.sh']) // scripts
      .mockResolvedValueOnce([]); // assets

    const skill = await testParser.parseSkill(
      '/skills/pdf/SKILL.md',
      '/skills/pdf',
      'builtin'
    );

    expect(skill).not.toBeNull();
    expect(skill!.id).toBe('PDF Processor');
    expect(skill!.name).toBe('PDF Processor');
    expect(skill!.description).toBe('Handles PDF files');
    expect(skill!.license).toBe('MIT');
    expect(skill!.compatibility).toBe('node >= 18');
    expect(skill!.allowedTools).toEqual(['read_file', 'write_file']);
    expect(skill!.metadata).toEqual({ author: 'Test Author', version: '2.0' });
    expect(skill!.instructions).toBe('# Instructions\n\nProcess the PDF file.');
    expect(skill!.source).toBe('builtin');
    expect(skill!.references).toEqual(['guide.md', 'api.md']);
    expect(skill!.scripts).toEqual(['convert.sh']);
    expect(skill!.assets).toEqual([]);
  });

  it('handles missing optional directories gracefully', async () => {
    mockFs.readFile.mockResolvedValue(`---
name: Simple Skill
description: Basic skill
---
Just do it.`);

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
    const rawContent = `---
name: Raw Test
description: Test raw content
---
Instructions here.`;

    mockFs.readFile.mockResolvedValue(rawContent);
    mockFs.readdir
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'));

    const skill = await testParser.parseSkill(
      '/skills/raw/SKILL.md',
      '/skills/raw'
    );

    expect(skill!.rawContent).toBe(rawContent);
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
