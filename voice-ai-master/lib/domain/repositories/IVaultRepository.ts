import type { RelationshipVaultData, SessionRecord } from '@/lib/domain/entities';

/**
 * Contract for the encrypted relationship vault.
 * Implementations handle encryption and persistence details.
 */
export interface IVaultRepository {
  getVault(coupleId: string): RelationshipVaultData | null;
  addSession(coupleId: string, session: SessionRecord): Promise<void>;
  getRecentSessions(coupleId: string, limit?: number): SessionRecord[];
  deleteVault(coupleId: string): Promise<void>;
  /** Format vault contents as an LLM-ready context string. */
  formatContext(coupleId: string): string;
}
