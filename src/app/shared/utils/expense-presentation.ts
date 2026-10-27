import { Expense } from '../models/expense.model';

// Presentation only: never infer a successful sync when metadata is absent.
export function expenseSyncLabel(expense: Expense): string | null {
  const status = (expense as Expense & { _syncStatus?: string })._syncStatus;
  const labels: Record<string, string> = {
    synced: 'SYNC.SYNCED',
    pending: 'SYNC.PENDING_SYNC',
    conflict: 'SYNC.CONFLICT_DETECTED',
    error: 'SYNC.SYNC_FAILED',
    failed: 'SYNC.SYNC_FAILED',
    offline: 'MOBILE.OFFLINE',
    syncing: 'MOBILE.SYNCING',
  };
  return status ? labels[status] || null : null;
}

export interface ExpenseSyncAttention {
  label: string;
  tone: 'pending' | 'problem';
}

/**
 * Sync state worth showing on a ledger row. A synced row is the calm
 * default and shows nothing; pending/offline/syncing read as "pending",
 * conflicts and failures as "problem".
 */
export function expenseSyncAttention(
  expense: Expense
): ExpenseSyncAttention | null {
  const status = (expense as Expense & { _syncStatus?: string })._syncStatus;
  if (!status || status === 'synced') return null;
  const label = expenseSyncLabel(expense);
  if (!label) return null;
  const problem =
    status === 'conflict' || status === 'error' || status === 'failed';
  return { label, tone: problem ? 'problem' : 'pending' };
}
