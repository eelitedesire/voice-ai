/**
 * RAG API Endpoint
 *
 * POST /api/rag — Run the full RAG pipeline for a couple's session
 * POST /api/rag?mode=safety — Run safety check only (lightweight)
 *
 * Also handles vault management:
 * GET  /api/rag?coupleId=xxx — Get vault summary for a couple
 * DELETE /api/rag?coupleId=xxx — Delete vault (right to erasure)
 */

import { NextRequest, NextResponse } from 'next/server';
import { runRAGPipeline, runLightRAGPipeline } from '@/lib/rag/orchestrator';
import {
  getVault,
  deleteVault,
  getSessionCount,
  getRecurringTriggers,
  formatVaultContext,
  addSessionRecord,
} from '@/lib/rag/relationship-vault';
import { RAGPipelineInput, SessionRecord } from '@/lib/rag/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const mode = new URL(request.url).searchParams.get('mode');

    // Validate required fields
    const { coupleId, currentTranscript } = body;
    if (!coupleId || typeof coupleId !== 'string') {
      return NextResponse.json(
        { error: 'coupleId is required' },
        { status: 400 },
      );
    }

    const input: RAGPipelineInput = {
      coupleId,
      currentTranscript: currentTranscript || [],
      currentMessage: body.currentMessage,
      currentSpeaker: body.currentSpeaker,
      chatHistory: body.chatHistory,
    };

    // Lightweight safety-only mode
    if (mode === 'safety') {
      const result = await runLightRAGPipeline(input);
      return NextResponse.json(result);
    }

    // Full pipeline
    const result = await runRAGPipeline(input);
    return NextResponse.json({
      safety: {
        safe: result.safety.safe,
        severity: result.safety.severity,
        flags: result.safety.flags,
        crisisResources: result.safety.crisisResources,
      },
      context: {
        relevantSessionCount: result.context.relevantSessions.length,
        recurringTriggers: result.context.recurringTriggers.map(t => ({
          description: t.description,
          category: t.category,
          frequency: t.frequency,
        })),
        patternSummary: result.context.patternSummary,
        similarPastConflicts: result.context.similarPastConflicts,
      },
      supervision: {
        selectedFramework: result.supervision.selectedFramework,
        conflictClassification: result.supervision.conflictClassification,
        reasoning: result.supervision.reasoning,
        deEscalationNeeded: result.supervision.deEscalationNeeded,
        suggestedInterventions: result.supervision.suggestedInterventions,
        techniques: result.supervision.techniques.map(t => ({
          name: t.name,
          description: t.description,
          whenToUse: t.whenToUse,
        })),
      },
      vectorContext: result.vectorContext ? {
        clinicalContext: result.vectorContext.clinicalContext ? '(available)' : '(empty)',
        relationshipContext: result.vectorContext.relationshipContext ? '(available)' : '(empty)',
        redLineTriggered: result.vectorContext.redLineTriggered,
        vectorRetrievalTimeMs: result.vectorContext.vectorRetrievalTimeMs,
      } : null,
      augmentedContext: result.augmentedContext,
      safetyOverride: result.safetyOverride,
      processingTimeMs: result.processingTimeMs,
    });
  } catch (error) {
    console.error('[RAG API] Error:', error);
    return NextResponse.json(
      { error: 'RAG pipeline failed. Please try again.' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const coupleId = new URL(request.url).searchParams.get('coupleId');
    if (!coupleId) {
      return NextResponse.json(
        { error: 'coupleId query parameter is required' },
        { status: 400 },
      );
    }

    const sessionCount = getSessionCount(coupleId);
    const triggers = getRecurringTriggers(coupleId);
    const vaultContext = formatVaultContext(coupleId);

    return NextResponse.json({
      coupleId,
      sessionCount,
      recurringTriggers: triggers.map(t => ({
        description: t.description,
        category: t.category,
        frequency: t.frequency,
      })),
      formattedContext: vaultContext,
    });
  } catch (error) {
    console.error('[RAG API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve vault data.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const coupleId = new URL(request.url).searchParams.get('coupleId');
    if (!coupleId) {
      return NextResponse.json(
        { error: 'coupleId query parameter is required' },
        { status: 400 },
      );
    }

    const deleted = deleteVault(coupleId);
    return NextResponse.json({
      deleted,
      message: deleted
        ? `Vault for couple "${coupleId}" has been permanently deleted.`
        : `No vault found for couple "${coupleId}".`,
    });
  } catch (error) {
    console.error('[RAG API] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete vault.' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/rag — Store a session record in the vault
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { coupleId, session } = body;

    if (!coupleId || !session) {
      return NextResponse.json(
        { error: 'coupleId and session are required' },
        { status: 400 },
      );
    }

    // Validate session record shape
    const record: SessionRecord = {
      id: session.id || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      coupleId,
      date: session.date || Date.now(),
      summary: session.summary || '',
      emotionalTone: session.emotionalTone || {
        primary: 'neutral',
        intensity: 5,
        trajectory: 'stable',
      },
      triggers: session.triggers || [],
      conflictPatterns: session.conflictPatterns || [],
      breakthroughs: session.breakthroughs || [],
      speakerDynamics: session.speakerDynamics || {},
    };

    addSessionRecord(coupleId, record);

    return NextResponse.json({
      stored: true,
      sessionId: record.id,
      message: `Session record stored in vault for couple "${coupleId}".`,
    });
  } catch (error) {
    console.error('[RAG API] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to store session record.' },
      { status: 500 },
    );
  }
}
