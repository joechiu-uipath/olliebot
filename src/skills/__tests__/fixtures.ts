/**
 * Test Fixtures for SkillParser Tests
 *
 * Sample skill markdown content for testing.
 */

/**
 * Basic skill with all required frontmatter fields.
 */
export const BASIC_SKILL_MD = `---
name: Test Skill
description: A test skill for unit testing
---
# Instructions

Do the thing.`;

/**
 * Skill with comprehensive frontmatter.
 */
export const COMPREHENSIVE_SKILL_MD = `---
name: PDF Processor
description: Handles PDF files
id: pdf-processor
license: MIT
compatibility: node >= 18
allowed-tools: read_file write_file
metadata:
  author: Test Author
  version: '2.0'
---
# Instructions

Process the PDF file.`;

/**
 * Skill with no ID or name (tests fallback to dirname).
 */
export const ANONYMOUS_SKILL_MD = `---
description: Anonymous skill
---
Body`;

/**
 * Skill with CRLF line endings (Windows-style).
 */
export const CRLF_SKILL_MD = '---\r\nname: CRLF Skill\r\ndescription: Windows style\r\n---\r\nBody';

/**
 * Skill with quoted values.
 */
export const QUOTED_SKILL_MD = `---
name: "Quoted Name"
description: 'Single Quoted'
---
Body`;

/**
 * Skill with empty description value.
 */
export const EMPTY_VALUE_SKILL_MD = `---
name: Test
description:
---
Body`;

/**
 * Content with no frontmatter.
 */
export const NO_FRONTMATTER = 'No frontmatter here\nJust content';

/**
 * Skill with tool restrictions.
 */
export const TOOL_RESTRICTED_SKILL_MD = `---
name: Tool Skill
allowed-tools: tool1 tool2 tool3
---
Body`;

/**
 * Mock filesystem responses.
 */
export const MOCK_FS_RESPONSES = {
  references: ['guide.md', 'api.md'],
  scripts: ['convert.sh'],
  assets: [] as string[],
  emptyDir: [] as string[],
};
