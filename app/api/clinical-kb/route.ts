/**
 * Clinical Knowledge Base API Endpoint
 *
 * GET  /api/clinical-kb?q=<query>                  — Search the clinical knowledge base
 * GET  /api/clinical-kb?q=<query>&framework=<name> — Search within a specific framework
 * GET  /api/clinical-kb?id=<protocol-id>           — Get a specific protocol
 * GET  /api/clinical-kb?framework=<name>           — Get all protocols for a framework
 * GET  /api/clinical-kb                            — Get knowledge base stats
 *
 * POST /api/clinical-kb — Run dual-stream retrieval (clinical + relationship)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClinicalKnowledgeBase } from '@/lib/rag/clinical-knowledge-base';
import { dualStreamRetrieval, clinicalSearch } from '@/lib/rag/context-merger';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    const framework = url.searchParams.get('framework');
    const protocolId = url.searchParams.get('id');
    const topK = parseInt(url.searchParams.get('topK') ?? '5', 10);

    const kb = getClinicalKnowledgeBase();

    // Get a specific protocol by ID
    if (protocolId) {
      const protocol = kb.getProtocol(protocolId);
      if (!protocol) {
        return NextResponse.json(
          { error: `Protocol "${protocolId}" not found` },
          { status: 404 },
        );
      }
      return NextResponse.json({ protocol });
    }

    // Search the knowledge base
    if (query) {
      const results = kb.search(query, topK, 0.1, framework ?? undefined);
      return NextResponse.json({
        query,
        framework: framework ?? 'all',
        results: results.map(r => ({
          protocol: {
            id: r.protocol.id,
            framework: r.protocol.framework,
            name: r.protocol.name,
            description: r.protocol.description,
            whenToUse: r.protocol.whenToUse,
            antidote: r.protocol.antidote,
            steps: r.protocol.steps,
            redLine: r.protocol.redLine,
          },
          relevanceScore: Math.round(r.relevanceScore * 100) / 100,
        })),
        formattedContext: kb.formatForContext(results),
      });
    }

    // Get all protocols for a framework
    if (framework) {
      const protocols = kb.getFrameworkProtocols(framework);
      return NextResponse.json({
        framework,
        protocols: protocols.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          whenToUse: p.whenToUse,
        })),
        count: protocols.length,
      });
    }

    // Return stats
    return NextResponse.json({
      protocolCount: kb.protocolCount,
      initialized: kb.isInitialized,
      protocolIds: kb.getAllProtocolIds(),
    });
  } catch (error) {
    console.error('[Clinical KB API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to query clinical knowledge base.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { coupleId, query, preferredFramework, clinicalTopK, relationshipTopK } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'query is required' },
        { status: 400 },
      );
    }

    // If no coupleId, do clinical-only search
    if (!coupleId) {
      const results = clinicalSearch(query, clinicalTopK ?? 5, preferredFramework);
      const kb = getClinicalKnowledgeBase();
      return NextResponse.json({
        mode: 'clinical-only',
        clinical: {
          results: results.map(r => ({
            protocol: {
              id: r.protocol.id,
              framework: r.protocol.framework,
              name: r.protocol.name,
            },
            relevanceScore: Math.round(r.relevanceScore * 100) / 100,
          })),
          formattedContext: kb.formatForContext(results),
        },
      });
    }

    // Full dual-stream retrieval
    const result = dualStreamRetrieval({
      coupleId,
      query,
      preferredFramework,
      clinicalTopK,
      relationshipTopK,
    });

    return NextResponse.json({
      mode: 'dual-stream',
      clinical: {
        protocolCount: result.clinical.protocols.length,
        protocols: result.clinical.protocols.map(r => ({
          id: r.protocol.id,
          framework: r.protocol.framework,
          name: r.protocol.name,
          relevanceScore: Math.round(r.relevanceScore * 100) / 100,
        })),
        redLineTriggered: result.redLineTriggered,
      },
      relationship: {
        resultCount: result.relationship.results.length,
        breakthroughCount: result.relationship.breakthroughs.length,
        triggerCount: result.relationship.triggers.length,
      },
      mergedContext: result.mergedContext,
      processingTimeMs: result.processingTimeMs,
    });
  } catch (error) {
    console.error('[Clinical KB API] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to run dual-stream retrieval.' },
      { status: 500 },
    );
  }
}
