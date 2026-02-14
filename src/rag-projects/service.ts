/**
 * RAG Project Service
 * Main orchestration service for RAG projects.
 * Scans folders, manages indexing, and handles queries.
 *
 * Supports multi-strategy indexing: each project can configure multiple
 * retrieval strategies that index the same chunks differently and fuse
 * results at query time.
 */

import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readdirSync, statSync, watch, type FSWatcher } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join, relative, basename } from 'path';
import { createLanceStore, type LanceStore } from './lance-store.js';
import { loadAndChunkDocument, isSupportedFile, getMimeType, SUPPORTED_EXTENSIONS } from './document-loader.js';
import {
  type RAGProject,
  type RAGProjectDetails,
  type RAGDocument,
  type ProjectManifest,
  type IndexingProgress,
  type QueryRequest,
  type QueryResponse,
  type EmbeddingProvider,
  type VectorRecord,
  type SummarizationProvider,
  type DocumentChunk,
  DEFAULT_PROJECT_SETTINGS,
} from './types.js';
import { RAG_DEFAULT_TOP_K } from '../constants.js';
import {
  createStrategiesFromConfig,
  ChunkPreprocessor,
  type RetrievalStrategy,
  type StrategyConfig,
} from './strategies/index.js';
import { fuseResults, type StrategySearchResult } from './fusion.js';

const DOCUMENTS_FOLDER = 'documents';
const OLLIEBOT_FOLDER = '.olliebot';
const MANIFEST_FILE = 'manifest.json';

/**
 * RAG Project Service - manages RAG projects.
 */
export class RAGProjectService extends EventEmitter {
  private ragDir: string;
  private embeddingProvider: EmbeddingProvider;
  private summarizationProvider: SummarizationProvider | null = null;
  private stores: Map<string, LanceStore> = new Map();
  private indexingInProgress: Map<string, boolean> = new Map();
  private watcher: FSWatcher | null = null;

  constructor(ragDir: string, embeddingProvider: EmbeddingProvider) {
    super();
    this.ragDir = ragDir;
    this.embeddingProvider = embeddingProvider;
  }

  /**
   * Set the summarization provider (typically backed by LLMService.fast).
   */
  setSummarizationProvider(provider: SummarizationProvider): void {
    this.summarizationProvider = provider;
  }

  /**
   * Initialize the service.
   */
  async init(): Promise<void> {
    // Ensure the RAG directory exists
    if (!existsSync(this.ragDir)) {
      mkdirSync(this.ragDir, { recursive: true });
      console.log(`[RAGProjects] Created RAG directory: ${this.ragDir}`);
    }

    // Scan existing projects
    const projects = await this.listProjects();
    console.log(`[RAGProjects] Found ${projects.length} projects`);

    // Start watching for new projects
    this.startWatching();
  }

  /**
   * Start watching the RAG directory for changes.
   */
  private startWatching(): void {
    try {
      this.watcher = watch(this.ragDir, { persistent: false }, (eventType, filename) => {
        if (filename && !filename.startsWith('.')) {
          this.emit('projects_changed');
        }
      });
    } catch (error) {
      console.warn('[RAGProjects] Failed to watch directory:', error);
    }
  }

  /**
   * List all RAG projects.
   */
  async listProjects(): Promise<RAGProject[]> {
    if (!existsSync(this.ragDir)) {
      return [];
    }

    const entries = readdirSync(this.ragDir, { withFileTypes: true });
    const projects: RAGProject[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }

      try {
        const projectPath = join(this.ragDir, entry.name);
        const project = await this.getProjectInfo(entry.name, projectPath);
        if (project) {
          projects.push(project);
        }
      } catch (error) {
        console.warn(`[RAGProjects] Error loading project ${entry.name}:`, error);
      }
    }

    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get basic project info.
   */
  private async getProjectInfo(id: string, projectPath: string): Promise<RAGProject | null> {
    const docsPath = join(projectPath, DOCUMENTS_FOLDER);

    // Check if this looks like a RAG project (has documents folder)
    if (!existsSync(docsPath)) {
      // Auto-create documents folder if project folder exists
      mkdirSync(docsPath, { recursive: true });
    }

    // Load or initialize manifest
    const manifest = await this.loadOrCreateManifest(id, projectPath);

    // Count documents
    const docFiles = this.scanDocuments(docsPath);
    const indexedCount = Object.values(manifest.documents).filter(
      (doc) => doc.status === 'indexed'
    ).length;

    return {
      id: manifest.id,
      name: this.formatProjectName(id),
      path: projectPath,
      documentCount: docFiles.length,
      indexedCount,
      vectorCount: manifest.vectorCount,
      settings: manifest.settings,
      lastIndexedAt: manifest.lastIndexedAt,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      summary: manifest.summary,
    };
  }

  /**
   * Get detailed project info including document list.
   */
  async getProjectDetails(projectId: string): Promise<RAGProjectDetails | null> {
    const projectPath = join(this.ragDir, projectId);
    if (!existsSync(projectPath)) {
      return null;
    }

    const project = await this.getProjectInfo(projectId, projectPath);
    if (!project) {
      return null;
    }

    // Get document list
    const manifest = await this.loadOrCreateManifest(projectId, projectPath);
    const docsPath = join(projectPath, DOCUMENTS_FOLDER);
    const docFiles = this.scanDocuments(docsPath);

    // Merge file system info with manifest status
    const documents: RAGDocument[] = docFiles.map((filePath) => {
      const relativePath = relative(docsPath, filePath);
      const stats = statSync(filePath);
      const existing = manifest.documents[relativePath];

      return {
        path: relativePath,
        name: basename(relativePath),
        size: stats.size,
        mimeType: getMimeType(relativePath),
        status: existing?.status || 'pending',
        chunkCount: existing?.chunkCount,
        lastModified: stats.mtime.toISOString(),
        indexedAt: existing?.indexedAt,
        error: existing?.error,
      };
    });

    return {
      ...project,
      documents,
    };
  }

  // ─── Multi-Strategy Helpers ──────────────────────────────────────

  /**
   * Determine if a project uses multi-strategy indexing.
   */
  private isMultiStrategy(settings: { strategies?: StrategyConfig[] }): boolean {
    return Array.isArray(settings.strategies) && settings.strategies.filter((s) => s.enabled).length > 0;
  }

  /**
   * Get the enabled strategies for a project's settings.
   * Returns null if the project uses legacy single-strategy mode.
   */
  private getEnabledStrategies(settings: { strategies?: StrategyConfig[] }): RetrievalStrategy[] | null {
    if (!this.isMultiStrategy(settings)) {
      return null;
    }

    return createStrategiesFromConfig(settings.strategies!, {
      summarizationProvider: this.summarizationProvider,
    });
  }

  /**
   * Check if any of the enabled strategies require LLM preprocessing
   * (keyword or summary). If so, we use ChunkPreprocessor to make one
   * combined LLM call instead of N separate calls per chunk.
   */
  private needsLLMPreprocessing(strategies: RetrievalStrategy[]): boolean {
    return strategies.some((s) => s.id === 'keyword' || s.id === 'summary');
  }

  /**
   * Index a single chunk across all enabled strategies.
   *
   * When multiple strategies need LLM preprocessing (keyword + summary),
   * a single combined LLM call via ChunkPreprocessor produces both outputs.
   * Each strategy receives the shared preprocessed data instead of making
   * its own redundant LLM call with the same input tokens.
   */
  private async indexChunkMultiStrategy(
    chunk: DocumentChunk,
    strategies: RetrievalStrategy[],
    projectId: string,
    relativePath: string,
    store: LanceStore,
    preprocessor: ChunkPreprocessor | null
  ): Promise<void> {
    // One LLM call produces keywords + summary for all strategies that need it
    const preprocessed = preprocessor
      ? await preprocessor.process(chunk.text)
      : undefined;

    for (const strategy of strategies) {
      // Strategy uses preprocessed data if available, otherwise falls back to its own LLM call
      const preparedText = await strategy.prepareChunkText(chunk, preprocessed);

      // Embed the transformed text
      const embedding = await this.embeddingProvider.embed(preparedText);

      // Create vector record (text field stores the ORIGINAL chunk text for display)
      const record: VectorRecord = {
        id: `${projectId}:${relativePath}:${chunk.chunkIndex}`,
        documentPath: chunk.documentPath,
        text: chunk.text,
        vector: embedding,
        chunkIndex: chunk.chunkIndex,
        contentType: chunk.contentType,
        metadata: chunk.metadata,
      };

      await store.addVectorsToTable([record], strategy.id);
    }
  }

  // ─── Indexing ────────────────────────────────────────────────────

  /**
   * Index a project's documents with incremental support.
   * Only re-indexes new or changed files; skips unchanged files.
   *
   * If the project has strategies configured, indexes chunks across all
   * enabled strategies (multi-strategy mode). Otherwise falls back to
   * legacy single-table indexing.
   *
   * @param projectId - The project to index
   * @param force - If true, clears all vectors and re-indexes everything
   */
  async indexProject(projectId: string, force: boolean = false): Promise<void> {
    const projectPath = join(this.ragDir, projectId);
    if (!existsSync(projectPath)) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Check if already indexing
    if (this.indexingInProgress.get(projectId)) {
      throw new Error(`Indexing already in progress for project: ${projectId}`);
    }

    this.indexingInProgress.set(projectId, true);

    try {
      const docsPath = join(projectPath, DOCUMENTS_FOLDER);
      const manifest = await this.loadOrCreateManifest(projectId, projectPath);
      const docFiles = this.scanDocuments(docsPath);

      // Get or create store
      let store = this.stores.get(projectId);
      if (!store) {
        store = await createLanceStore(projectPath, this.embeddingProvider);
        this.stores.set(projectId, store);
      }

      // Determine if this is multi-strategy
      const strategies = this.getEnabledStrategies(manifest.settings);
      const useMultiStrategy = strategies !== null && strategies.length > 0;

      if (useMultiStrategy) {
        console.log(
          `[RAGProjects] Multi-strategy mode: ${strategies.map((s) => s.id).join(', ')}`
        );
      }

      // Force re-index: clear everything and treat all files as new
      if (force) {
        console.log(`[RAGProjects] Force re-index: clearing all vectors for ${projectId}`);
        if (useMultiStrategy) {
          await store.clearAllTables();
        } else {
          await store.clear();
        }
        store = await createLanceStore(projectPath, this.embeddingProvider);
        this.stores.set(projectId, store);
        manifest.documents = {};
      }

      // Categorize files: new, changed, unchanged, removed
      const currentFilePaths = new Set<string>();
      const filesToIndex: Array<{ filePath: string; relativePath: string; isNew: boolean }> = [];

      for (const filePath of docFiles) {
        const relativePath = relative(docsPath, filePath);
        currentFilePaths.add(relativePath);

        const existingDoc = manifest.documents[relativePath];
        const stats = statSync(filePath);
        const fileModified = stats.mtime.toISOString();

        if (!existingDoc) {
          // New file (or force re-index cleared the manifest)
          filesToIndex.push({ filePath, relativePath, isNew: true });
        } else if (
          existingDoc.status !== 'indexed' ||
          !existingDoc.indexedAt ||
          new Date(fileModified) > new Date(existingDoc.indexedAt)
        ) {
          // Changed or previously failed file
          filesToIndex.push({ filePath, relativePath, isNew: false });
        }
        // else: unchanged, skip
      }

      // Find removed files (in manifest but not on disk)
      const removedFiles: string[] = [];
      for (const docPath of Object.keys(manifest.documents)) {
        if (!currentFilePaths.has(docPath)) {
          removedFiles.push(docPath);
        }
      }

      // Calculate totals for progress
      const totalToProcess = filesToIndex.length + removedFiles.length;
      const unchangedCount = docFiles.length - filesToIndex.length;

      console.log(`[RAGProjects] ${force ? 'Force' : 'Incremental'} index: ${filesToIndex.length} to index, ${unchangedCount} unchanged, ${removedFiles.length} removed`);

      // Emit start event
      this.emitProgress({
        projectId,
        status: 'started',
        totalDocuments: totalToProcess,
        processedDocuments: 0,
        timestamp: new Date().toISOString(),
      });

      let processedCount = 0;

      // Remove vectors for deleted files
      for (const removedPath of removedFiles) {
        if (useMultiStrategy) {
          for (const strategy of strategies) {
            await store.deleteByDocumentFromTable(removedPath, strategy.id);
          }
        } else {
          await store.deleteByDocument(removedPath);
        }
        delete manifest.documents[removedPath];
        processedCount++;
      }

      // Remove vectors for changed files (before re-indexing)
      for (const { relativePath, isNew } of filesToIndex) {
        if (!isNew) {
          if (useMultiStrategy) {
            for (const strategy of strategies) {
              await store.deleteByDocumentFromTable(relativePath, strategy.id);
            }
          } else {
            await store.deleteByDocument(relativePath);
          }
        }
      }

      // Process new and changed files
      for (const { filePath, relativePath } of filesToIndex) {

        // Emit progress
        this.emitProgress({
          projectId,
          status: 'processing',
          totalDocuments: totalToProcess,
          processedDocuments: processedCount,
          currentDocument: relativePath,
          timestamp: new Date().toISOString(),
        });

        try {
          // Load and chunk the document
          const chunks = await loadAndChunkDocument(filePath, relativePath, {
            chunkSize: manifest.settings.chunkSize,
            chunkOverlap: manifest.settings.chunkOverlap,
          });

          // Generate file summary from first 10 chunks
          let fileSummary: string | undefined;
          if (this.summarizationProvider && chunks.length > 0) {
            const chunksToSummarize = chunks.slice(0, 10);
            const combinedText = chunksToSummarize.map((c) => c.text).join('\n\n');
            try {
              fileSummary = await this.summarizationProvider.summarize(
                combinedText,
                'Summarize this document content in 1-2 sentences. Focus on the main topics and key information.'
              );
            } catch (error) {
              console.warn(`[RAGProjects] Failed to summarize ${relativePath}:`, error);
            }
          }

          if (useMultiStrategy) {
            // Create preprocessor if any strategy needs LLM (keyword/summary).
            // One LLM call per chunk produces both keywords + summary.
            const preprocessor = this.needsLLMPreprocessing(strategies) && this.summarizationProvider
              ? new ChunkPreprocessor(this.summarizationProvider)
              : null;

            // Multi-strategy: index each chunk across all strategies
            for (const chunk of chunks) {
              await this.indexChunkMultiStrategy(
                chunk,
                strategies,
                projectId,
                relativePath,
                store,
                preprocessor
              );
            }
          } else {
            // Legacy: single direct embedding
            const vectors: VectorRecord[] = [];
            for (const chunk of chunks) {
              const embedding = await this.embeddingProvider.embed(chunk.text);
              vectors.push({
                id: `${projectId}:${relativePath}:${chunk.chunkIndex}`,
                documentPath: chunk.documentPath,
                text: chunk.text,
                vector: embedding,
                chunkIndex: chunk.chunkIndex,
                contentType: chunk.contentType,
                metadata: chunk.metadata,
              });
            }

            // Add to store
            if (vectors.length > 0) {
              await store.addVectors(vectors);
            }
          }

          // Update manifest
          const stats = statSync(filePath);
          manifest.documents[relativePath] = {
            path: relativePath,
            name: basename(relativePath),
            size: stats.size,
            mimeType: getMimeType(relativePath),
            status: 'indexed',
            chunkCount: chunks.length,
            lastModified: stats.mtime.toISOString(),
            indexedAt: new Date().toISOString(),
            summary: fileSummary,
          };
        } catch (error) {
          console.error(`[RAGProjects] Error indexing ${relativePath}:`, error);

          // Update manifest with error
          const stats = statSync(filePath);
          manifest.documents[relativePath] = {
            path: relativePath,
            name: basename(relativePath),
            size: stats.size,
            mimeType: getMimeType(relativePath),
            status: 'failed',
            lastModified: stats.mtime.toISOString(),
            error: error instanceof Error ? error.message : String(error),
          };
        }

        processedCount++;
      }

      // Generate project summary from all file summaries
      if (this.summarizationProvider) {
        const fileSummaries = Object.values(manifest.documents)
          .filter((doc) => doc.summary)
          .map((doc) => `**${doc.name}**: ${doc.summary}`)
          .join('\n\n');

        if (fileSummaries) {
          try {
            manifest.summary = await this.summarizationProvider.summarize(
              fileSummaries,
              'Write a 1-sentence summary (max 50 words) of what this document collection covers. Be concise and specific.'
            );
          } catch (error) {
            console.warn(`[RAGProjects] Failed to generate project summary:`, error);
          }
        }
      }

      // Update manifest with final stats (get actual count from store)
      if (useMultiStrategy) {
        manifest.vectorCount = await store.getTotalVectorCount();
      } else {
        manifest.vectorCount = await store.getVectorCount();
      }
      manifest.lastIndexedAt = new Date().toISOString();
      manifest.updatedAt = new Date().toISOString();
      await this.saveManifest(projectPath, manifest);

      // Emit completion
      this.emitProgress({
        projectId,
        status: 'completed',
        totalDocuments: totalToProcess,
        processedDocuments: processedCount,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Emit error
      this.emitProgress({
        projectId,
        status: 'error',
        totalDocuments: 0,
        processedDocuments: 0,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      throw error;
    } finally {
      this.indexingInProgress.set(projectId, false);
    }
  }

  // ─── Querying ────────────────────────────────────────────────────

  /**
   * Query a project's vectors.
   *
   * If the project uses multi-strategy indexing, queries all enabled strategies
   * in parallel and fuses the results. Otherwise falls back to legacy single-table search.
   */
  async queryProject(projectId: string, request: QueryRequest): Promise<QueryResponse> {
    const projectPath = join(this.ragDir, projectId);
    if (!existsSync(projectPath)) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const startTime = Date.now();

    // Get or create store
    let store = this.stores.get(projectId);
    if (!store) {
      store = await createLanceStore(projectPath, this.embeddingProvider);
      this.stores.set(projectId, store);
    }

    // Load manifest to check strategy configuration
    const manifest = await this.loadOrCreateManifest(projectId, projectPath);
    const strategies = this.getEnabledStrategies(manifest.settings);
    const useMultiStrategy = strategies !== null && strategies.length > 0;

    if (useMultiStrategy) {
      return this.queryMultiStrategy(
        store,
        request,
        strategies,
        manifest.settings.strategies!,
        manifest.settings.fusionMethod || 'rrf',
        startTime
      );
    }

    // Legacy single-strategy search
    const results = await store.search(
      request.query,
      request.topK || RAG_DEFAULT_TOP_K,
      request.minScore || 0,
      request.contentType || 'all'
    );

    return {
      results,
      queryTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Execute a multi-strategy query: query each strategy in parallel, then fuse results.
   */
  private async queryMultiStrategy(
    store: LanceStore,
    request: QueryRequest,
    strategies: RetrievalStrategy[],
    strategyConfigs: StrategyConfig[],
    defaultFusionMethod: string,
    startTime: number
  ): Promise<QueryResponse> {
    const topK = request.topK || RAG_DEFAULT_TOP_K;
    const minScore = request.minScore || 0;
    const contentType = request.contentType || 'all';
    const fusionMethod = request.fusionMethod || defaultFusionMethod;

    // Query each strategy in parallel
    const strategyResultPromises = strategies.map(async (strategy): Promise<StrategySearchResult> => {
      // Transform the query text according to this strategy
      const preparedQuery = await strategy.prepareQueryText(request.query);

      // Embed the transformed query
      const queryVector = await this.embeddingProvider.embed(preparedQuery);

      // Search this strategy's table
      // Request more results than topK so fusion has a good pool
      const results = await store.searchByVector(
        queryVector,
        strategy.id,
        topK * 2,
        minScore,
        contentType
      );

      return {
        strategyId: strategy.id,
        results,
      };
    });

    const strategyResults = await Promise.all(strategyResultPromises);

    // Fuse results from all strategies
    const fusedResults = fuseResults(
      strategyResults,
      strategyConfigs,
      fusionMethod as 'rrf' | 'weighted_score',
      topK
    );

    // Map fused results back to SearchResult format
    // Include fusedScore and strategy provenance in metadata
    const results = fusedResults.map((fused) => ({
      id: fused.id,
      documentPath: fused.documentPath,
      text: fused.text,
      score: fused.fusedScore,
      chunkIndex: fused.chunkIndex,
      contentType: fused.contentType,
      metadata: {
        ...fused.metadata,
        fusedScore: fused.fusedScore,
        strategyScores: fused.strategyScores,
      },
    }));

    return {
      results,
      queryTimeMs: Date.now() - startTime,
      strategiesUsed: strategies.map((s) => s.id),
      fusionMethod: fusionMethod as 'rrf' | 'weighted_score',
    };
  }

  /**
   * Check if a project is currently being indexed.
   */
  isIndexing(projectId: string): boolean {
    return this.indexingInProgress.get(projectId) || false;
  }

  /**
   * Scan for supported documents in a directory.
   */
  private scanDocuments(docsPath: string): string[] {
    if (!existsSync(docsPath)) {
      return [];
    }

    const files: string[] = [];

    const scan = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scan(fullPath);
        } else if (entry.isFile() && isSupportedFile(entry.name)) {
          files.push(fullPath);
        }
      }
    };

    scan(docsPath);
    return files;
  }

  /**
   * Load or create a project manifest.
   */
  private async loadOrCreateManifest(
    projectId: string,
    projectPath: string
  ): Promise<ProjectManifest> {
    const olliebotPath = join(projectPath, OLLIEBOT_FOLDER);
    const manifestPath = join(olliebotPath, MANIFEST_FILE);

    if (existsSync(manifestPath)) {
      try {
        const content = await readFile(manifestPath, 'utf-8');
        return JSON.parse(content) as ProjectManifest;
      } catch (error) {
        console.warn(`[RAGProjects] Failed to load manifest for ${projectId}:`, error);
      }
    }

    // Create new manifest
    const now = new Date().toISOString();
    const manifest: ProjectManifest = {
      id: projectId,
      createdAt: now,
      updatedAt: now,
      settings: { ...DEFAULT_PROJECT_SETTINGS },
      documents: {},
      vectorCount: 0,
    };

    // Ensure directory exists
    if (!existsSync(olliebotPath)) {
      mkdirSync(olliebotPath, { recursive: true });
    }

    await this.saveManifest(projectPath, manifest);
    return manifest;
  }

  /**
   * Save a project manifest.
   */
  private async saveManifest(projectPath: string, manifest: ProjectManifest): Promise<void> {
    const olliebotPath = join(projectPath, OLLIEBOT_FOLDER);
    const manifestPath = join(olliebotPath, MANIFEST_FILE);

    if (!existsSync(olliebotPath)) {
      mkdirSync(olliebotPath, { recursive: true });
    }

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Format project ID as a display name.
   */
  private formatProjectName(id: string): string {
    return id
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Emit an indexing progress event.
   */
  private emitProgress(progress: IndexingProgress): void {
    this.emit('indexing_progress', progress);
  }

  /**
   * Get supported file extensions.
   */
  getSupportedExtensions(): string[] {
    return Object.keys(SUPPORTED_EXTENSIONS);
  }

  /**
   * Close the service and release resources.
   */
  async close(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    for (const store of this.stores.values()) {
      await store.close();
    }
    this.stores.clear();
  }
}
