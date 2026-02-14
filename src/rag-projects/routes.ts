/**
 * RAG Projects API Routes
 * Hono routes for RAG project management with native file upload.
 */

import { Hono } from 'hono';
import { existsSync, mkdirSync, statSync, createReadStream } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { join, extname, basename } from 'path';
import type { RAGProjectService } from './service.js';
import { MAX_FILE_UPLOAD_SIZE_BYTES, RAG_DEFAULT_TOP_K } from '../constants.js';
import { getAvailableStrategies } from './strategies/index.js';
import type { FusionMethod } from './strategies/types.js';

// Supported file extensions for upload
const SUPPORTED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.json', '.csv', '.html']);

/**
 * Create Hono router for RAG project endpoints.
 */
export function createRAGProjectRoutes(ragService: RAGProjectService): Hono {
  const router = new Hono();

  /**
   * GET /projects
   * List all RAG projects.
   */
  router.get('/projects', async (c) => {
    try {
      const projects = await ragService.listProjects();

      // Add indexing status to each project
      const projectsWithStatus = projects.map((project) => ({
        ...project,
        isIndexing: ragService.isIndexing(project.id),
      }));

      return c.json(projectsWithStatus);
    } catch (error) {
      console.error('[RAGProjects] Failed to list projects:', error);
      return c.json({ error: 'Failed to list projects' }, 500);
    }
  });

  /**
   * GET /projects/:id
   * Get detailed project info including document list.
   */
  router.get('/projects/:id', async (c) => {
    try {
      const projectId = c.req.param('id');
      const project = await ragService.getProjectDetails(projectId);

      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }

      return c.json({
        ...project,
        isIndexing: ragService.isIndexing(projectId),
      });
    } catch (error) {
      console.error(`[RAGProjects] Failed to get project:`, error);
      return c.json({ error: 'Failed to get project details' }, 500);
    }
  });

  /**
   * POST /projects/:id/index
   * Trigger indexing for a project.
   * Returns immediately; progress is sent via WebSocket.
   * Query param: ?force=true to force full re-index
   */
  router.post('/projects/:id/index', async (c) => {
    try {
      const projectId = c.req.param('id');
      const forceQuery = c.req.query('force');
      let force = forceQuery === 'true';

      // Also check body for force param
      try {
        const body = await c.req.json();
        if (body.force === true) force = true;
      } catch {
        // No body or invalid JSON - ignore
      }

      // Check if already indexing
      if (ragService.isIndexing(projectId)) {
        return c.json({ error: 'Indexing already in progress' }, 409);
      }

      // Start indexing (async - don't wait for completion)
      ragService.indexProject(projectId, force).catch((error) => {
        console.error(`[RAGProjects] Indexing error for ${projectId}:`, error);
      });

      return c.json({
        success: true,
        message: force ? 'Force re-indexing started' : 'Indexing started',
        projectId,
        force,
      });
    } catch (error) {
      console.error(`[RAGProjects] Failed to start indexing:`, error);
      return c.json({ error: 'Failed to start indexing' }, 500);
    }
  });

  /**
   * POST /projects/:id/query
   * Query a project's vectors.
   */
  router.post('/projects/:id/query', async (c) => {
    try {
      const projectId = c.req.param('id');
      const body = await c.req.json();
      const { query, topK, minScore, contentType, fusionMethod } = body;

      if (!query || typeof query !== 'string') {
        return c.json({ error: 'Query is required' }, 400);
      }

      const response = await ragService.queryProject(projectId, {
        query,
        topK: typeof topK === 'number' ? topK : RAG_DEFAULT_TOP_K,
        minScore: typeof minScore === 'number' ? minScore : 0,
        contentType: contentType || 'all',
        ...(fusionMethod && { fusionMethod: fusionMethod as FusionMethod }),
      });

      return c.json(response);
    } catch (error) {
      console.error(`[RAGProjects] Query error:`, error);
      return c.json({ error: 'Query failed' }, 500);
    }
  });

  /**
   * GET /supported-extensions
   * Get list of supported file extensions.
   */
  router.get('/supported-extensions', (c) => {
    return c.json({
      extensions: ragService.getSupportedExtensions(),
    });
  });

  /**
   * GET /strategies
   * Get list of available retrieval strategies and their descriptions.
   */
  router.get('/strategies', (c) => {
    return c.json({
      strategies: getAvailableStrategies(),
      fusionMethods: [
        { id: 'rrf', name: 'Reciprocal Rank Fusion', description: 'Rank-based fusion that is robust to score scale differences between strategies.' },
        { id: 'weighted_score', name: 'Weighted Score', description: 'Combines raw similarity scores using configured weights per strategy.' },
      ],
    });
  });

  /**
   * POST /projects/:id/upload
   * Upload files to a project's documents folder.
   * Uses native Hono formData() parsing (no multer).
   * Query param: ?index=true to trigger indexing after upload
   */
  router.post('/projects/:id/upload', async (c) => {
    const uploadedFiles: string[] = [];
    const tempFiles: string[] = [];

    try {
      const projectId = c.req.param('id');
      const triggerIndex = c.req.query('index') === 'true';

      // Check if project exists
      const project = await ragService.getProjectDetails(projectId);
      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }

      // Parse multipart form data using native Hono
      const formData = await c.req.formData();
      const files = formData.getAll('files') as File[];

      if (!files || files.length === 0) {
        return c.json({ error: 'No files provided' }, 400);
      }

      // Get project documents path
      const docsPath = join(project.path, 'documents');
      if (!existsSync(docsPath)) {
        mkdirSync(docsPath, { recursive: true });
      }

      // Process each file
      for (const file of files) {
        // Validate file extension
        const ext = extname(file.name).toLowerCase();
        if (!SUPPORTED_UPLOAD_EXTENSIONS.has(ext)) {
          return c.json({
            error: `Unsupported file type: ${ext}. Supported: ${[...SUPPORTED_UPLOAD_EXTENSIONS].join(', ')}`,
            uploadedFiles,
          }, 400);
        }

        // Check file size
        if (file.size > MAX_FILE_UPLOAD_SIZE_BYTES) {
          return c.json({
            error: `File ${file.name} exceeds maximum size of ${MAX_FILE_UPLOAD_SIZE_BYTES / 1024 / 1024}MB`,
            uploadedFiles,
          }, 400);
        }

        // Write file to documents folder
        const destPath = join(docsPath, file.name);
        const arrayBuffer = await file.arrayBuffer();
        await writeFile(destPath, Buffer.from(arrayBuffer));
        uploadedFiles.push(file.name);
        console.log(`[RAGProjects] Uploaded file: ${file.name} to ${projectId}`);
      }

      // Trigger indexing if requested (async - don't wait)
      if (triggerIndex && !ragService.isIndexing(projectId)) {
        ragService.indexProject(projectId, false).catch((error) => {
          console.error(`[RAGProjects] Indexing error for ${projectId}:`, error);
        });
      }

      return c.json({
        success: true,
        projectId,
        uploadedFiles,
        indexingStarted: triggerIndex && !ragService.isIndexing(projectId),
      });
    } catch (error) {
      // Clean up temp files on error
      for (const tempPath of tempFiles) {
        try {
          await unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      console.error(`[RAGProjects] Upload error:`, error);
      return c.json({
        error: error instanceof Error ? error.message : 'Upload failed',
        uploadedFiles,
      }, 500);
    }
  });

  /**
   * GET /projects/:id/documents/:filename
   * Serve a document file from a project's documents folder.
   * Primarily used for PDF viewing in the frontend.
   */
  router.get('/projects/:id/documents/:filename', async (c) => {
    try {
      const projectId = c.req.param('id');
      const filename = c.req.param('filename');

      // Validate filename to prevent path traversal
      const sanitizedFilename = basename(filename);
      if (sanitizedFilename !== filename || filename.includes('..')) {
        return c.json({ error: 'Invalid filename' }, 400);
      }

      // Get project details
      const project = await ragService.getProjectDetails(projectId);
      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }

      // Build full path to document
      const docPath = join(project.path, 'documents', sanitizedFilename);

      // Check file exists
      if (!existsSync(docPath)) {
        return c.json({ error: 'Document not found' }, 404);
      }

      // Get file stats for content-length
      const stats = statSync(docPath);

      // Determine content type based on extension
      const ext = extname(sanitizedFilename).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.html': 'text/html',
      };

      const contentType = contentTypes[ext] || 'application/octet-stream';

      // Read the file and return as response
      const { readFileSync } = await import('fs');
      const content = readFileSync(docPath);

      return new Response(content, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(stats.size),
          'Content-Disposition': `inline; filename="${sanitizedFilename}"`,
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      console.error(`[RAGProjects] Error serving document:`, error);
      return c.json({ error: 'Failed to serve document' }, 500);
    }
  });

  return router;
}
