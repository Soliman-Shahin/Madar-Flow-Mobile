/** Month-over-month spending comparison shown in the home month hero. */
export interface ExpenseComparison {
  status: 'loading' | 'ready' | 'unavailable';
  direction?: 'less' | 'more' | 'same' | 'new' | 'none';
  percentage?: number | null;
}
