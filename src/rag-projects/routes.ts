/**
 * RAG Projects API Routes
 * Express routes for RAG project management.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync, statSync } from 'fs';
import { copyFile, unlink } from 'fs/promises';
import { join, extname, basename } from 'path';
import type { RAGProjectService } from './service.js';
import { MAX_FILE_UPLOAD_SIZE_BYTES, RAG_DEFAULT_TOP_K } from '../constants.js';
import { getAvailableStrategies } from './strategies/index.js';
import type { FusionMethod } from './strategies/types.js';
import type { RerankerMethod } from './reranker.js';

// Supported file extensions for upload
const SUPPORTED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.json', '.csv', '.html']);

// Configure multer for file upload (temp storage)
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: MAX_FILE_UPLOAD_SIZE_BYTES,
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
      const { query, topK, minScore, contentType, fusionMethod, reranker } = req.body;

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query is required' });
        return;
      }

      const response = await ragService.queryProject(projectId, {
        query,
        topK: typeof topK === 'number' ? topK : RAG_DEFAULT_TOP_K,
        minScore: typeof minScore === 'number' ? minScore : 0,
        contentType: contentType || 'all',
        ...(fusionMethod && { fusionMethod: fusionMethod as FusionMethod }),
        ...(reranker && { reranker: reranker as RerankerMethod }),
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
   * GET /api/rag/strategies
   * Get list of available retrieval strategies and their descriptions.
   */
  router.get('/strategies', (_req: Request, res: Response) => {
    res.json({
      strategies: getAvailableStrategies(),
      fusionMethods: [
        { id: 'rrf', name: 'Reciprocal Rank Fusion', description: 'Rank-based fusion that is robust to score scale differences between strategies.' },
        { id: 'weighted_score', name: 'Weighted Score', description: 'Combines raw similarity scores using configured weights per strategy.' },
      ],
      rerankers: [
        { id: 'none', name: 'None', description: 'No re-ranking. Use fusion output directly.' },
        { id: 'llm', name: 'LLM Re-ranker', description: 'LLM judges each chunk\'s relevance to the query from text. Applied after fusion.' },
      ],
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

  /**
   * GET /api/rag/projects/:id/documents/:filename
   * Serve a document file from a project's documents folder.
   * Primarily used for PDF viewing in the frontend.
   */
  router.get('/projects/:id/documents/:filename', async (req: Request, res: Response) => {
    try {
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;

      // Validate filename to prevent path traversal
      const sanitizedFilename = basename(filename);
      if (sanitizedFilename !== filename || filename.includes('..')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }

      // Get project details
      const project = await ragService.getProjectDetails(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      // Build full path to document
      const docPath = join(project.path, 'documents', sanitizedFilename);

      // Check file exists
      if (!existsSync(docPath)) {
        res.status(404).json({ error: 'Document not found' });
        return;
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

      // Set headers for inline viewing (especially for PDFs)
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Content-Disposition', `inline; filename="${sanitizedFilename}"`);

      // Allow CORS for PDF viewer
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Send file
      res.sendFile(docPath);
    } catch (error) {
      console.error(`[RAGProjects] Error serving document:`, error);
      res.status(500).json({ error: 'Failed to serve document' });
    }
  });

  return router;
}
