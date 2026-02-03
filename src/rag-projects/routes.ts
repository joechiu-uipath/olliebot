/**
 * RAG Projects API Routes
 * Express routes for RAG project management.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { copyFile, unlink } from 'fs/promises';
import { join, extname } from 'path';
import type { RAGProjectService } from './service.js';

// Supported file extensions for upload
const SUPPORTED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.json', '.csv', '.html']);

// Configure multer for file upload (temp storage)
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (SUPPORTED_UPLOAD_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Supported: ${[...SUPPORTED_UPLOAD_EXTENSIONS].join(', ')}`));
    }
  },
});

/**
 * Create Express router for RAG project endpoints.
 */
export function createRAGProjectRoutes(ragService: RAGProjectService): Router {
  const router = Router();

  /**
   * GET /api/rag/projects
   * List all RAG projects.
   */
  router.get('/projects', async (_req: Request, res: Response) => {
    try {
      const projects = await ragService.listProjects();

      // Add indexing status to each project
      const projectsWithStatus = projects.map((project) => ({
        ...project,
        isIndexing: ragService.isIndexing(project.id),
      }));

      res.json(projectsWithStatus);
    } catch (error) {
      console.error('[RAGProjects] Failed to list projects:', error);
      res.status(500).json({ error: 'Failed to list projects' });
    }
  });

  /**
   * GET /api/rag/projects/:id
   * Get detailed project info including document list.
   */
  router.get('/projects/:id', async (req: Request, res: Response) => {
    try {
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const project = await ragService.getProjectDetails(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      res.json({
        ...project,
        isIndexing: ragService.isIndexing(projectId),
      });
    } catch (error) {
      console.error(`[RAGProjects] Failed to get project:`, error);
      res.status(500).json({ error: 'Failed to get project details' });
    }
  });

  /**
   * POST /api/rag/projects/:id/index
   * Trigger indexing for a project.
   * Returns immediately; progress is sent via WebSocket.
   * Query param: ?force=true to force full re-index
   */
  router.post('/projects/:id/index', async (req: Request, res: Response) => {
    try {
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const force = req.query.force === 'true' || req.body.force === true;

      // Check if already indexing
      if (ragService.isIndexing(projectId)) {
        res.status(409).json({ error: 'Indexing already in progress' });
        return;
      }

      // Start indexing (async - don't wait for completion)
      ragService.indexProject(projectId, force).catch((error) => {
        console.error(`[RAGProjects] Indexing error for ${projectId}:`, error);
      });

      res.json({
        success: true,
        message: force ? 'Force re-indexing started' : 'Indexing started',
        projectId,
        force,
      });
    } catch (error) {
      console.error(`[RAGProjects] Failed to start indexing:`, error);
      res.status(500).json({ error: 'Failed to start indexing' });
    }
  });

  /**
   * POST /api/rag/projects/:id/query
   * Query a project's vectors.
   */
  router.post('/projects/:id/query', async (req: Request, res: Response) => {
    try {
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { query, topK, minScore, contentType } = req.body;

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query is required' });
        return;
      }

      const response = await ragService.queryProject(projectId, {
        query,
        topK: typeof topK === 'number' ? topK : 10,
        minScore: typeof minScore === 'number' ? minScore : 0,
        contentType: contentType || 'all',
      });

      res.json(response);
    } catch (error) {
      console.error(`[RAGProjects] Query error:`, error);
      res.status(500).json({ error: 'Query failed' });
    }
  });

  /**
   * GET /api/rag/supported-extensions
   * Get list of supported file extensions.
   */
  router.get('/supported-extensions', (_req: Request, res: Response) => {
    res.json({
      extensions: ragService.getSupportedExtensions(),
    });
  });

  /**
   * POST /api/rag/projects/:id/upload
   * Upload files to a project's documents folder.
   * Query param: ?index=true to trigger indexing after upload
   */
  router.post('/projects/:id/upload', upload.array('files', 20), async (req: Request, res: Response) => {
    const uploadedFiles: string[] = [];
    const tempFiles: string[] = [];

    try {
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const triggerIndex = req.query.index === 'true';

      // Check if project exists
      const project = await ragService.getProjectDetails(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files provided' });
        return;
      }

      // Get project documents path
      const docsPath = join(project.path, 'documents');
      if (!existsSync(docsPath)) {
        mkdirSync(docsPath, { recursive: true });
      }

      // Copy each file to documents folder
      for (const file of files) {
        tempFiles.push(file.path);
        const destPath = join(docsPath, file.originalname);
        await copyFile(file.path, destPath);
        uploadedFiles.push(file.originalname);
        console.log(`[RAGProjects] Uploaded file: ${file.originalname} to ${projectId}`);
      }

      // Clean up temp files
      for (const tempPath of tempFiles) {
        try {
          await unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      // Trigger indexing if requested (async - don't wait)
      if (triggerIndex && !ragService.isIndexing(projectId)) {
        ragService.indexProject(projectId, false).catch((error) => {
          console.error(`[RAGProjects] Indexing error for ${projectId}:`, error);
        });
      }

      res.json({
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
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Upload failed',
        uploadedFiles,
      });
    }
  });

  return router;
}
