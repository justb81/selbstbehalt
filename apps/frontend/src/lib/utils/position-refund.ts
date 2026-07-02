// SPDX-License-Identifier: Apache-2.0
export type RefundTone = 'none' | 'full' | 'partial' | 'rejected';
export interface RefundStatus {
  tone: RefundTone;
  /** Tailwind text-color class for the amount; '' when tone === 'none'. */
  className: string;
  /** refund − charged (negative = under-reimbursed); null when nothing to show. */
  difference: number | null;
}
/** Classifies a charged vs. actually-refunded amount for colour-coding the Betrag. */
export function refundStatus(charged: number, refund: number | null | undefined): RefundStatus {
  if (refund == null) return { tone: 'none', className: '', difference: null };
  if (refund === 0)
    return { tone: 'rejected', className: 'text-destructive', difference: refund - charged };
  if (refund >= charged) return { tone: 'full', className: 'text-success', difference: null };
  return { tone: 'partial', className: 'text-warning', difference: refund - charged };
}
